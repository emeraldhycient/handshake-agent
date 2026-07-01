import { encodeCursor, decodeCursor } from './transaction-cursor';

describe('transaction-cursor codec', () => {
  it('round-trips a (createdAt, id) keyset position', () => {
    const createdAt = new Date('2026-06-29T10:00:00.000Z');
    const id = '0190f4a2-0000-7000-8000-000000000001';
    const decoded = decodeCursor(encodeCursor(createdAt, id));
    expect(decoded).not.toBeNull();
    expect(decoded!.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(decoded!.id).toBe(id);
  });

  it('returns null for an empty string', () => {
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null for a non-keyset base64url payload (no separator)', () => {
    // base64url of "garbage" decodes but has no "|" separator.
    expect(decodeCursor('garbage')).toBeNull();
  });

  it('returns null when the encoded timestamp is not a valid date', () => {
    const bad = Buffer.from('not-a-date|some-id', 'utf8').toString('base64url');
    expect(decodeCursor(bad)).toBeNull();
  });

  it('returns null when the id half is empty', () => {
    const noId = Buffer.from('2026-06-29T10:00:00.000Z|', 'utf8').toString(
      'base64url',
    );
    expect(decodeCursor(noId)).toBeNull();
  });
});
