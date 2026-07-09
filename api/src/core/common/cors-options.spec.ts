import type { ConfigService } from '@nestjs/config';

import { buildAllowedOrigins } from './cors-options';

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

describe('buildAllowedOrigins', () => {
  it('defaults both origins to localhost:3000 in dev and de-dupes them', () => {
    expect(buildAllowedOrigins(makeConfig({}))).toEqual([
      'http://localhost:3000',
    ]);
  });

  it('returns the distinct web + admin origins when both are configured', () => {
    const origins = buildAllowedOrigins(
      makeConfig({
        WEB_APP_BASE_URL: 'https://app.handshake.example',
        ADMIN_APP_BASE_URL: 'https://admin.handshake.example',
      }),
    );
    expect(origins).toEqual([
      'https://app.handshake.example',
      'https://admin.handshake.example',
    ]);
  });

  it('de-dupes when web and admin share the same origin', () => {
    const origins = buildAllowedOrigins(
      makeConfig({
        WEB_APP_BASE_URL: 'https://handshake.example',
        ADMIN_APP_BASE_URL: 'https://handshake.example',
      }),
    );
    expect(origins).toEqual(['https://handshake.example']);
  });

  it('never contains a wildcard', () => {
    const origins = buildAllowedOrigins(
      makeConfig({
        WEB_APP_BASE_URL: 'https://app.example',
        ADMIN_APP_BASE_URL: 'https://admin.example',
      }),
    );
    expect(origins).not.toContain('*');
  });
});
