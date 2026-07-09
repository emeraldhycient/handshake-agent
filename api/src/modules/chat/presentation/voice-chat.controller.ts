import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { VoiceChatResponse } from '@handshake-agent/contracts';

import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import { WebChatService } from '../application/web-chat.service';
import {
  TRANSCRIPTION_PORT,
  type ITranscriptionPort,
} from '../../media/application/ports/transcription.port';
import configuration, {
  type AppConfig,
} from '../../../core/config/configuration';

/** Multer in-memory file shape (no disk write, no @types/multer dep). */
interface UploadedAudio {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/**
 * Hard stream-time ceiling for the multipart voice upload, enforced by multer
 * so an oversize body is aborted mid-stream (413) instead of being fully
 * buffered into RAM before the size check in the handler can reject it.
 *
 * FileInterceptor options are fixed at class-decoration time — before DI or
 * the layered ConfigService exist — so this pins the static JSON default
 * (media.voice.maxUploadBytes). The per-request check in the handler remains
 * the authoritative, admin-tunable gate: it can tighten the limit at runtime
 * (DB-admin layer, root CLAUDE.md §7); raising it ABOVE this static ceiling
 * requires a deploy, which is acceptable — the ceiling exists to bound memory.
 */
const VOICE_UPLOAD_HARD_CEILING_BYTES =
  configuration().media.voice.maxUploadBytes;

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class VoiceChatController {
  constructor(
    private readonly chatService: WebChatService,
    @Inject(TRANSCRIPTION_PORT)
    private readonly transcription: ITranscriptionPort,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Post('voice')
  @HttpCode(200)
  // Multer's LIMIT_FILE_SIZE is mapped to a 413 PayloadTooLargeException by
  // @nestjs/platform-express' transformException (an HttpException, so the
  // global DomainExceptionFilter passes it through — never an opaque 500).
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: VOICE_UPLOAD_HARD_CEILING_BYTES },
    }),
  )
  async sendVoice(
    @UploadedFile() file: UploadedAudio | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VoiceChatResponse> {
    if (!file) {
      throw new BadRequestException('Missing audio file');
    }

    const mediaConfig = this.config.get<AppConfig['media']>('media');
    const allowed = mediaConfig?.voice.allowedMimeTypes ?? [];
    const maxBytes = mediaConfig?.voice.maxUploadBytes ?? 0;

    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported audio type: ${file.mimetype}`);
    }

    if (maxBytes > 0 && file.size > maxBytes) {
      throw new BadRequestException('Audio file too large');
    }

    const { text } = await this.transcription.transcribe({
      bytes: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname,
    });

    // If the transcript is empty or whitespace, feed the agent a fallback phrase
    // so it produces a real clarification response with valid ids — no fabrication.
    const trimmed = text.trim();
    const res = await this.chatService.handleMessage({
      userId: user.userId,
      text: trimmed || '(unintelligible audio)',
    });

    return { ...res, transcript: trimmed };
  }
}
