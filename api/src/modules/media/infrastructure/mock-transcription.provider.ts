import { Injectable, Logger } from '@nestjs/common';

import type {
  ITranscriptionPort,
  TranscribeInput,
  TranscriptionResult,
} from '../application/ports/transcription.port';

/** Dev/test transcription provider — returns a fixed transcript, no network. */
@Injectable()
export class MockTranscriptionProvider implements ITranscriptionPort {
  private readonly logger = new Logger(MockTranscriptionProvider.name);

  transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    // Never log bytes (§3.5). Log only size + mime for observability.
    this.logger.log(`[mock-stt] ${input.bytes.length}B ${input.mimeType}`);
    return Promise.resolve({ text: '[voice note transcript]' });
  }
}
