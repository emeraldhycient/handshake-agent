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
import type { AppConfig } from '../../../core/config/configuration';

/** Multer in-memory file shape (no disk write, no @types/multer dep). */
interface UploadedAudio {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

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
  @UseInterceptors(FileInterceptor('audio'))
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
