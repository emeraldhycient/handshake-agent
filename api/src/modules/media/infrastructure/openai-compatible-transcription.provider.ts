import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import type {
  ITranscriptionPort,
  TranscribeInput,
  TranscriptionResult,
} from '../application/ports/transcription.port';

interface TranscriptionApiResponse {
  text: string;
}

/**
 * Real STT adapter for any OpenAI-compatible /audio/transcriptions endpoint
 * (OpenAI Whisper, Groq whisper-large-v3, self-hosted whisper.cpp servers).
 * Vendor is swapped by changing TRANSCRIPTION_BASE_URL — same multipart contract.
 */
@Injectable()
export class OpenAiCompatibleTranscriptionProvider implements ITranscriptionPort {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    const apiKey = this.config.get<string>('TRANSCRIPTION_API_KEY') ?? '';
    if (!apiKey) {
      throw new Error('TRANSCRIPTION_API_KEY is not configured');
    }
    const base =
      this.config.get<string>('TRANSCRIPTION_BASE_URL') ??
      'https://api.openai.com/v1';
    const model = this.config.get<string>('TRANSCRIPTION_MODEL') ?? 'whisper-1';

    // Node 18+ global FormData/Blob; axios serializes them as multipart.
    const form = new FormData();
    form.append('model', model);
    // Buffer satisfies BlobPart at runtime (Node 18+) but TS's strictest
    // lib types flag SharedArrayBuffer in ArrayBufferLike; cast at this
    // SDK boundary only (root CLAUDE.md §13.4).
    form.append(
      'file',
      new Blob([input.bytes as unknown as ArrayBuffer], {
        type: input.mimeType,
      }),
      input.filename ?? 'audio',
    );

    const response = await firstValueFrom(
      this.http.post<TranscriptionApiResponse>(
        `${base}/audio/transcriptions`,
        form,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      ),
    );
    return { text: response.data.text ?? '' };
  }
}
