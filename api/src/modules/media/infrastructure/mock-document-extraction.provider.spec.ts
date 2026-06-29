import { MockDocumentExtractionProvider } from './mock-document-extraction.provider';

describe('MockDocumentExtractionProvider', () => {
  it('returns kind=none by default, no network', async () => {
    const provider = new MockDocumentExtractionProvider();
    const r = await provider.extract({
      bytes: Buffer.from('img'),
      mimeType: 'image/jpeg',
    });
    expect(r).toEqual({ kind: 'none' });
  });
});
