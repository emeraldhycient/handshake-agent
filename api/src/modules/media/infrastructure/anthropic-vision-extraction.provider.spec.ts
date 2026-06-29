import { AnthropicVisionExtractionProvider } from './anthropic-vision-extraction.provider';

function makeConfig() {
  const values: Record<string, string> = {
    ANTHROPIC_API_KEY: 'sk-ant',
    MEDIA_EXTRACTION_MODEL: 'claude-opus-4-8',
  };
  return {
    get: (k: string) => values[k],
  } as unknown as import('@nestjs/config').ConfigService;
}

describe('AnthropicVisionExtractionProvider', () => {
  it('returns the structured result the model produces', async () => {
    const invoke = jest.fn().mockResolvedValue({
      kind: 'crypto_address',
      address: 'TXYZ1234567890abcdefghijklmnopqrst',
      network: 'tron',
    });
    const provider = new AnthropicVisionExtractionProvider(makeConfig());
    // Override the protected model factory to avoid any network / real SDK call.
    (
      provider as unknown as {
        structuredModel: () => { invoke: typeof invoke };
      }
    ).structuredModel = () => ({ invoke });

    const r = await provider.extract({
      bytes: Buffer.from('img'),
      mimeType: 'image/jpeg',
    });
    expect(r).toMatchObject({ kind: 'crypto_address', network: 'tron' });
    // Asserts an image content block carrying base64 was sent.
    const calls = invoke.mock.calls as unknown[][];
    const message = calls[0][0];
    expect(JSON.stringify(message)).toContain('image_url');
  });

  it('throws when ANTHROPIC_API_KEY is missing', async () => {
    const cfg = {
      get: (k: string) => (k === 'ANTHROPIC_API_KEY' ? '' : 'm'),
    } as unknown as import('@nestjs/config').ConfigService;
    const provider = new AnthropicVisionExtractionProvider(cfg);
    await expect(
      provider.extract({ bytes: Buffer.from('a'), mimeType: 'image/jpeg' }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});
