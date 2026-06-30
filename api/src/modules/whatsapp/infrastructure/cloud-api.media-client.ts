import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import type { AppConfig } from '../../../core/config/configuration';
import type {
  DownloadedMedia,
  IWhatsAppMediaClient,
} from '../application/ports/whatsapp-media.port';

interface MediaMetadata {
  url: string;
  mime_type: string;
}

/**
 * Downloads inbound WhatsApp media via the Graph media API.
 *
 * Two-step fetch: GET {base}/{version}/{mediaId} → { url, mime_type },
 * then GET {url} (arraybuffer) → bytes. Never logs bytes or the token (§3.5).
 *
 * Config reads:
 *  - Env keys (WHATSAPP_GRAPH_BASE_URL, WHATSAPP_GRAPH_VERSION,
 *    WHATSAPP_ACCESS_TOKEN) are read with explicit string generics on a plain
 *    ConfigService.  Using ConfigService<Env, true> conflicts with the
 *    media.whatsapp.maxMediaBytes JSON-layer key (not an Env key), so a plain
 *    ConfigService is injected and each call uses an explicit generic to stay
 *    type-safe (root CLAUDE.md §7, task-14 instructions).
 *  - The media.whatsapp.maxMediaBytes JSON-layer key is a nested AppConfig
 *    path, not an Env key, so it is read via get<AppConfig['media']>('media')
 *    and indexed — this is the established pattern for non-env config keys.
 */
@Injectable()
export class CloudApiMediaClient implements IWhatsAppMediaClient {
  private readonly metaBase: string;
  private readonly authHeader: string;
  private readonly maxBytes: number;

  constructor(
    private readonly http: HttpService,
    // Plain ConfigService (no type params) so the same instance can resolve
    // both Env keys (string values) and the JSON-layer AppConfig 'media' object.
    // Each get<T>() call carries an explicit generic for local type safety.
    private readonly config: ConfigService,
  ) {
    const base = this.config.get<string>('WHATSAPP_GRAPH_BASE_URL') ?? '';
    const version = this.config.get<string>('WHATSAPP_GRAPH_VERSION') ?? '';
    const token = this.config.get<string>('WHATSAPP_ACCESS_TOKEN') ?? '';

    this.metaBase = `${base}/${version}`;
    // authHeader is built once at construction and never logged (§3.5).
    this.authHeader = `Bearer ${token}`;

    // media.whatsapp.maxMediaBytes is a JSON-layer AppConfig path — not an Env
    // key — so we read the whole 'media' section and index into it.
    const media = this.config.get<AppConfig['media']>('media');
    this.maxBytes = media?.whatsapp.maxMediaBytes ?? 25_000_000;
  }

  async download(mediaId: string): Promise<DownloadedMedia> {
    // Step 1: resolve the media id to a short-lived CDN URL + mime_type.
    const meta = await firstValueFrom(
      this.http.get<MediaMetadata>(`${this.metaBase}/${mediaId}`, {
        headers: { Authorization: this.authHeader },
      }),
    );
    const { url, mime_type: mimeType } = meta.data;

    // Step 2: fetch the actual bytes. Authorization header is required on the
    // CDN URL too. responseType arraybuffer gives us a Buffer-convertible value.
    const file = await firstValueFrom(
      this.http.get<ArrayBuffer>(url, {
        headers: { Authorization: this.authHeader },
        responseType: 'arraybuffer',
      }),
    );
    const bytes = Buffer.from(file.data);

    if (bytes.length > this.maxBytes) {
      throw new Error(
        `Inbound media too large: ${bytes.length} bytes (max ${this.maxBytes})`,
      );
    }

    return { bytes, mimeType };
  }
}
