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

  describe('CORS_EXTRA_ORIGINS', () => {
    it('appends a single extra origin after web + admin', () => {
      const origins = buildAllowedOrigins(
        makeConfig({
          WEB_APP_BASE_URL: 'https://usehandshake.ai',
          ADMIN_APP_BASE_URL: 'https://admin.example',
          CORS_EXTRA_ORIGINS: 'https://legacy.up.railway.app',
        }),
      );
      expect(origins).toEqual([
        'https://usehandshake.ai',
        'https://admin.example',
        'https://legacy.up.railway.app',
      ]);
    });

    it('splits a comma-separated list and trims surrounding whitespace', () => {
      const origins = buildAllowedOrigins(
        makeConfig({
          WEB_APP_BASE_URL: 'https://app.example',
          ADMIN_APP_BASE_URL: 'https://admin.example',
          CORS_EXTRA_ORIGINS: 'https://a.example ,  https://b.example',
        }),
      );
      expect(origins).toEqual([
        'https://app.example',
        'https://admin.example',
        'https://a.example',
        'https://b.example',
      ]);
    });

    it('drops empty segments from a trailing or doubled comma', () => {
      const origins = buildAllowedOrigins(
        makeConfig({
          WEB_APP_BASE_URL: 'https://app.example',
          ADMIN_APP_BASE_URL: 'https://admin.example',
          CORS_EXTRA_ORIGINS: 'https://a.example,,  ,',
        }),
      );
      expect(origins).toEqual([
        'https://app.example',
        'https://admin.example',
        'https://a.example',
      ]);
    });

    it('de-dupes an extra origin that already appears as web or admin', () => {
      const origins = buildAllowedOrigins(
        makeConfig({
          WEB_APP_BASE_URL: 'https://app.example',
          ADMIN_APP_BASE_URL: 'https://admin.example',
          CORS_EXTRA_ORIGINS: 'https://app.example,https://extra.example',
        }),
      );
      expect(origins).toEqual([
        'https://app.example',
        'https://admin.example',
        'https://extra.example',
      ]);
    });

    it('is a no-op when unset or empty (dev default unchanged)', () => {
      expect(buildAllowedOrigins(makeConfig({}))).toEqual([
        'http://localhost:3000',
      ]);
      expect(
        buildAllowedOrigins(makeConfig({ CORS_EXTRA_ORIGINS: '' })),
      ).toEqual(['http://localhost:3000']);
      expect(
        buildAllowedOrigins(makeConfig({ CORS_EXTRA_ORIGINS: '   ' })),
      ).toEqual(['http://localhost:3000']);
    });

    it('never admits a wildcard through the extra-origins list', () => {
      const origins = buildAllowedOrigins(
        makeConfig({
          WEB_APP_BASE_URL: 'https://app.example',
          ADMIN_APP_BASE_URL: 'https://admin.example',
          CORS_EXTRA_ORIGINS: '*,https://ok.example',
        }),
      );
      expect(origins).not.toContain('*');
      expect(origins).toEqual([
        'https://app.example',
        'https://admin.example',
        'https://ok.example',
      ]);
    });
  });
});
