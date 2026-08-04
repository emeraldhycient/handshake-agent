import { isValidUuid } from './uuid';

/**
 * Characterization tests for the shared `@db.Uuid` query guard.
 *
 * These lock the behavior the five Prisma repositories relied on before the
 * predicate was extracted here, so the extraction is provably verbatim.
 */
describe('isValidUuid', () => {
  const CANONICAL = '9f8b7c6d-1e2f-4a3b-8c9d-0e1f2a3b4c5d';

  describe('accepts syntactically valid UUIDs', () => {
    it('accepts a canonical lowercase UUID', () => {
      expect(isValidUuid(CANONICAL)).toBe(true);
    });

    it('accepts an uppercase UUID (the pattern is case-insensitive)', () => {
      expect(isValidUuid(CANONICAL.toUpperCase())).toBe(true);
    });

    it('accepts a mixed-case UUID', () => {
      expect(isValidUuid('9F8b7C6d-1E2f-4A3b-8C9d-0E1f2A3b4C5d')).toBe(true);
    });

    it('accepts a UUIDv7 (what the application generates for new rows)', () => {
      expect(isValidUuid('01912d3f-8a2b-7c4d-9e1f-2a3b4c5d6e7f')).toBe(true);
    });

    it('accepts the nil UUID — Postgres accepts it, so the guard must too', () => {
      expect(isValidUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
    });

    it('is deliberately version-agnostic: a version nibble outside 1-8 still passes', () => {
      // This is a syntax guard for `@db.Uuid`, not an RFC 4122 version check.
      expect(isValidUuid('9f8b7c6d-1e2f-9a3b-8c9d-0e1f2a3b4c5d')).toBe(true);
    });
  });

  describe('rejects values Postgres would reject on a @db.Uuid column', () => {
    it('rejects an empty string', () => {
      expect(isValidUuid('')).toBe(false);
    });

    it('rejects a non-UUID external reference (e.g. a processor tx ref)', () => {
      expect(isValidUuid('MockFLWRef-12345')).toBe(false);
    });

    it('rejects a UUID with the hyphens stripped', () => {
      expect(isValidUuid('9f8b7c6d1e2f4a3b8c9d0e1f2a3b4c5d')).toBe(false);
    });

    it('rejects a non-hex character', () => {
      expect(isValidUuid('9f8b7c6g-1e2f-4a3b-8c9d-0e1f2a3b4c5d')).toBe(false);
    });

    it('rejects a group of the wrong length', () => {
      expect(isValidUuid('9f8b7c6-1e2f-4a3b-8c9d-0e1f2a3b4c5d')).toBe(false);
    });
  });

  describe('is fully anchored — no partial or padded match', () => {
    it('rejects a UUID embedded in a longer string', () => {
      expect(isValidUuid(`id=${CANONICAL};`)).toBe(false);
    });

    it('rejects a brace-wrapped UUID', () => {
      expect(isValidUuid(`{${CANONICAL}}`)).toBe(false);
    });

    it('rejects leading whitespace', () => {
      expect(isValidUuid(` ${CANONICAL}`)).toBe(false);
    });

    it('rejects a trailing newline', () => {
      expect(isValidUuid(`${CANONICAL}\n`)).toBe(false);
    });
  });

  describe('is stateless across calls', () => {
    // The five repositories share this one module-level regex instance. A `g`
    // or `y` flag would make `.test()` advance `lastIndex` and return
    // alternating results — silently misrouting queries. Lock it here.
    it('returns a stable result when called repeatedly with the same value', () => {
      expect([
        isValidUuid(CANONICAL),
        isValidUuid(CANONICAL),
        isValidUuid(CANONICAL),
      ]).toEqual([true, true, true]);
    });

    it('returns a stable result when interleaving valid and invalid values', () => {
      expect([
        isValidUuid(CANONICAL),
        isValidUuid('not-a-uuid'),
        isValidUuid(CANONICAL),
        isValidUuid('not-a-uuid'),
      ]).toEqual([true, false, true, false]);
    });
  });
});
