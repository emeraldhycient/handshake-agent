import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import { TRANSCRIPTION_PORT } from './application/ports/transcription.port';
import { DOCUMENT_EXTRACTION_PORT } from './application/ports/document-extraction.port';
import { MockTranscriptionProvider } from './infrastructure/mock-transcription.provider';
import { OpenAiCompatibleTranscriptionProvider } from './infrastructure/openai-compatible-transcription.provider';
import { MockDocumentExtractionProvider } from './infrastructure/mock-document-extraction.provider';
import { AnthropicVisionExtractionProvider } from './infrastructure/anthropic-vision-extraction.provider';

/**
 * Shared media-intelligence module: speech-to-text + document extraction.
 * Mock adapters are active by default; real adapters bind when *_MOCK_MODE='false'
 * (mirrors IdentityModule's KYC_PROVIDER binding). Exports both ports.
 */
@Module({
  imports: [HttpModule],
  providers: [
    MockTranscriptionProvider,
    OpenAiCompatibleTranscriptionProvider,
    MockDocumentExtractionProvider,
    AnthropicVisionExtractionProvider,
    {
      provide: TRANSCRIPTION_PORT,
      inject: [
        ConfigService,
        MockTranscriptionProvider,
        OpenAiCompatibleTranscriptionProvider,
      ],
      useFactory: (
        config: ConfigService,
        mock: MockTranscriptionProvider,
        real: OpenAiCompatibleTranscriptionProvider,
      ) =>
        config.get<string>('TRANSCRIPTION_MOCK_MODE') === 'false' ? real : mock,
    },
    {
      provide: DOCUMENT_EXTRACTION_PORT,
      inject: [
        ConfigService,
        MockDocumentExtractionProvider,
        AnthropicVisionExtractionProvider,
      ],
      useFactory: (
        config: ConfigService,
        mock: MockDocumentExtractionProvider,
        real: AnthropicVisionExtractionProvider,
      ) =>
        config.get<string>('MEDIA_EXTRACTION_MOCK_MODE') === 'false'
          ? real
          : mock,
    },
  ],
  exports: [TRANSCRIPTION_PORT, DOCUMENT_EXTRACTION_PORT],
})
export class MediaModule {}
