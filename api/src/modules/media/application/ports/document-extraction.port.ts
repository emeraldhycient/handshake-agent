import type { DocumentExtractionResult } from '@handshake-agent/contracts';

/**
 * Image/document content-extraction port. Returns a *candidate* (crypto address /
 * bank details / none) the application validates before any persistence (§3.1).
 * Dev mock returns 'none'; the real adapter uses Claude vision (a port swap).
 */
export const DOCUMENT_EXTRACTION_PORT = Symbol('DOCUMENT_EXTRACTION_PORT');

export interface ExtractInput {
  bytes: Buffer;
  mimeType: string;
}
export interface IDocumentExtractionPort {
  extract(input: ExtractInput): Promise<DocumentExtractionResult>;
}
