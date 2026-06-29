import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { MediaModule } from './media.module';
import { TRANSCRIPTION_PORT } from './application/ports/transcription.port';
import { DOCUMENT_EXTRACTION_PORT } from './application/ports/document-extraction.port';
import { MockTranscriptionProvider } from './infrastructure/mock-transcription.provider';
import { OpenAiCompatibleTranscriptionProvider } from './infrastructure/openai-compatible-transcription.provider';
import { MockDocumentExtractionProvider } from './infrastructure/mock-document-extraction.provider';
import { AnthropicVisionExtractionProvider } from './infrastructure/anthropic-vision-extraction.provider';

async function moduleWith(env: Record<string, string>) {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => env],
      }),
      HttpModule,
      MediaModule,
    ],
  }).compile();
}

describe('MediaModule bindings', () => {
  it('binds mock adapters by default', async () => {
    const ref = await moduleWith({});
    expect(ref.get(TRANSCRIPTION_PORT)).toBeInstanceOf(
      MockTranscriptionProvider,
    );
    expect(ref.get(DOCUMENT_EXTRACTION_PORT)).toBeInstanceOf(
      MockDocumentExtractionProvider,
    );
  });

  it('binds the real transcription adapter when TRANSCRIPTION_MOCK_MODE=false', async () => {
    const ref = await moduleWith({ TRANSCRIPTION_MOCK_MODE: 'false' });
    expect(ref.get(TRANSCRIPTION_PORT)).toBeInstanceOf(
      OpenAiCompatibleTranscriptionProvider,
    );
  });

  it('binds the real extraction adapter when MEDIA_EXTRACTION_MOCK_MODE=false', async () => {
    const ref = await moduleWith({ MEDIA_EXTRACTION_MOCK_MODE: 'false' });
    expect(ref.get(DOCUMENT_EXTRACTION_PORT)).toBeInstanceOf(
      AnthropicVisionExtractionProvider,
    );
  });
});
