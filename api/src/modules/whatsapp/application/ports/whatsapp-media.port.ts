export const WHATSAPP_MEDIA_CLIENT = Symbol('WHATSAPP_MEDIA_CLIENT');

export interface DownloadedMedia {
  bytes: Buffer;
  mimeType: string;
}

export interface IWhatsAppMediaClient {
  /** Resolves a Cloud API media id to its raw bytes (two-step Graph fetch). */
  download(mediaId: string): Promise<DownloadedMedia>;
}
