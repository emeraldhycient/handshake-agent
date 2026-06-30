import { Injectable, Logger } from '@nestjs/common';
import type { DocumentExtractionResult } from '@handshake-agent/contracts';

import type {
  ExtractInput,
  IDocumentExtractionPort,
} from '../application/ports/document-extraction.port';

/** Dev/test extraction — returns 'none'; tests override the binding for fixtures. */
@Injectable()
export class MockDocumentExtractionProvider implements IDocumentExtractionPort {
  private readonly logger = new Logger(MockDocumentExtractionProvider.name);

  extract(input: ExtractInput): Promise<DocumentExtractionResult> {
    this.logger.log(`[mock-extract] ${input.bytes.length}B ${input.mimeType}`);
    return Promise.resolve({ kind: 'none' });
  }
}
