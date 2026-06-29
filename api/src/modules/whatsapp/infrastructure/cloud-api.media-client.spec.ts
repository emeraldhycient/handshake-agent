import { of } from 'rxjs';
import { CloudApiMediaClient } from './cloud-api.media-client';

function makeConfig() {
  const v: Record<string, unknown> = {
    WHATSAPP_GRAPH_BASE_URL: 'https://graph.facebook.com',
    WHATSAPP_GRAPH_VERSION: 'v25.0',
    WHATSAPP_ACCESS_TOKEN: 'TKN',
    'media.whatsapp.maxMediaBytes': 25000000,
  };
  return {
    get: (k: string) => v[k],
  } as unknown as import('@nestjs/config').ConfigService;
}

describe('CloudApiMediaClient', () => {
  it('resolves media id → url → bytes', async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(
        of({ data: { url: 'https://lookaside/abc', mime_type: 'audio/ogg' } }),
      )
      .mockReturnValueOnce(of({ data: Buffer.from('AUDIO') }));
    const http = { get } as unknown as import('@nestjs/axios').HttpService;
    const client = new CloudApiMediaClient(http, makeConfig());

    const res = await client.download('MID1');
    expect(res.mimeType).toBe('audio/ogg');
    expect(res.bytes.toString()).toBe('AUDIO');
    const firstCallArgs = get.mock.calls[0] as [string, ...unknown[]];
    expect(firstCallArgs[0]).toBe('https://graph.facebook.com/v25.0/MID1');
    const secondCallArgs = get.mock.calls[1] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(secondCallArgs[1].headers.Authorization).toBe('Bearer TKN');
  });

  it('rejects media larger than the cap', async () => {
    const big = Buffer.alloc(26000000);
    const get = jest
      .fn()
      .mockReturnValueOnce(
        of({ data: { url: 'https://lookaside/x', mime_type: 'image/jpeg' } }),
      )
      .mockReturnValueOnce(of({ data: big }));
    const client = new CloudApiMediaClient({ get } as never, makeConfig());
    await expect(client.download('X')).rejects.toThrow(/too large/i);
  });
});
