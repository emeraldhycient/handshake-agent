import { of } from 'rxjs';
import { OpenAiCompatibleTranscriptionProvider } from './openai-compatible-transcription.provider';

function makeConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    TRANSCRIPTION_BASE_URL: 'https://api.openai.com/v1',
    TRANSCRIPTION_API_KEY: 'sk-test',
    TRANSCRIPTION_MODEL: 'whisper-1',
    ...overrides,
  };
  return {
    get: (k: string) => values[k],
  } as unknown as import('@nestjs/config').ConfigService;
}

describe('OpenAiCompatibleTranscriptionProvider', () => {
  it('posts multipart to {base}/audio/transcriptions and returns the text', async () => {
    const post = jest
      .fn()
      .mockReturnValue(of({ data: { text: 'buy 50000 naira of usdt' } }));
    const http = { post } as unknown as import('@nestjs/axios').HttpService;
    const provider = new OpenAiCompatibleTranscriptionProvider(
      http,
      makeConfig(),
    );

    const res = await provider.transcribe({
      bytes: Buffer.from('audio'),
      mimeType: 'audio/ogg',
      filename: 'note.ogg',
    });

    expect(res.text).toBe('buy 50000 naira of usdt');
    const [url, , config] = post.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string> },
    ];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(config.headers.Authorization).toBe('Bearer sk-test');
  });

  it('throws a clean error when the API key is missing', async () => {
    const http = {
      post: jest.fn(),
    } as unknown as import('@nestjs/axios').HttpService;
    const provider = new OpenAiCompatibleTranscriptionProvider(
      http,
      makeConfig({ TRANSCRIPTION_API_KEY: '' }),
    );
    await expect(
      provider.transcribe({ bytes: Buffer.from('a'), mimeType: 'audio/ogg' }),
    ).rejects.toThrow(/TRANSCRIPTION_API_KEY/);
  });
});
