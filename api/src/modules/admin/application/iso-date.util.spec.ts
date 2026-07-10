import { toIso } from './iso-date.util';

describe('toIso', () => {
  it('renders a Date to an ISO-8601 string', () => {
    const date = new Date('2026-07-10T08:30:00.000Z');
    expect(toIso(date)).toBe('2026-07-10T08:30:00.000Z');
  });

  it('maps null to null', () => {
    expect(toIso(null)).toBeNull();
  });

  it('maps undefined to null (defensive — preserves the `value ?` call sites)', () => {
    // The generated Prisma types never yield `undefined` for a selected nullable
    // column, but the helper must never throw on it — three of the five copies it
    // replaces used a truthiness guard that tolerated undefined.
    expect(toIso(undefined as unknown as Date | null)).toBeNull();
  });
});
