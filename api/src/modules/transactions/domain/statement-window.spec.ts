import { resolveWindow } from './statement-window';

const cfg = { maxWindowDays: 400, timezoneOffsetMinutes: 60 }; // WAT

describe('resolveWindow (WAT day boundaries)', () => {
  // 2026-06-29T10:00:00Z = 11:00 WAT on Jun 29
  const now = new Date('2026-06-29T10:00:00.000Z');

  it('today = local midnight WAT → now', () => {
    const w = resolveWindow({ period: 'today' }, now, cfg);
    expect(w.from.toISOString()).toBe('2026-06-28T23:00:00.000Z'); // 00:00 WAT Jun 29
    expect(w.to.toISOString()).toBe(now.toISOString());
    expect(w.label).toBe('Today');
  });

  it('today is correct just after WAT midnight (UTC still previous day)', () => {
    // 2026-06-29T00:30:00Z = 01:30 WAT Jun 29 → "today" starts at 00:00 WAT Jun 29
    const justAfter = new Date('2026-06-29T00:30:00.000Z');
    const w = resolveWindow({ period: 'today' }, justAfter, cfg);
    expect(w.from.toISOString()).toBe('2026-06-28T23:00:00.000Z');
  });

  it('yesterday = full previous local day', () => {
    const w = resolveWindow({ period: 'yesterday' }, now, cfg);
    expect(w.from.toISOString()).toBe('2026-06-27T23:00:00.000Z'); // 00:00 WAT Jun 28
    expect(w.to.toISOString()).toBe('2026-06-28T22:59:59.999Z'); // 23:59:59.999 WAT Jun 28
    expect(w.label).toBe('Yesterday');
  });

  it('this_week = Monday 00:00 WAT → now (Jun 29 2026 is a Monday)', () => {
    const w = resolveWindow({ period: 'this_week' }, now, cfg);
    expect(w.from.toISOString()).toBe('2026-06-28T23:00:00.000Z'); // Mon Jun 29 00:00 WAT
    expect(w.label).toBe('This week');
  });

  it('last_month = full previous calendar month', () => {
    const w = resolveWindow({ period: 'last_month' }, now, cfg);
    expect(w.from.toISOString()).toBe('2026-04-30T23:00:00.000Z'); // 00:00 WAT May 1
    expect(w.to.toISOString()).toBe('2026-05-31T22:59:59.999Z'); // 23:59:59.999 WAT May 31
    expect(w.label).toBe('Last month');
  });

  it('explicit range uses start-of-from-day to end-of-to-day (WAT)', () => {
    const w = resolveWindow({ from: '2026-06-01', to: '2026-06-15' }, now, cfg);
    expect(w.from.toISOString()).toBe('2026-05-31T23:00:00.000Z'); // 00:00 WAT Jun 1
    expect(w.to.toISOString()).toBe('2026-06-15T22:59:59.999Z'); // 23:59:59.999 WAT Jun 15
    expect(w.label).toBe('Jun 1 – Jun 15, 2026');
  });

  it('clamps a future `to` to now', () => {
    const w = resolveWindow({ from: '2026-06-01', to: '2030-01-01' }, now, cfg);
    expect(w.to.toISOString()).toBe(now.toISOString());
  });

  it('clamps an over-long window to maxWindowDays', () => {
    const w = resolveWindow({ period: 'all' }, now, cfg);
    const days = (w.to.getTime() - w.from.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(400);
    expect(w.label).toBe('Last 400 days');
  });

  it('falls back to default (all) when from > to', () => {
    const w = resolveWindow({ from: '2026-06-15', to: '2026-06-01' }, now, cfg);
    expect(w.label).toBe('Last 400 days');
  });

  it('defaults to all when nothing is provided', () => {
    const w = resolveWindow({}, now, cfg);
    expect(w.label).toBe('Last 400 days');
  });

  // ── Relative-duration spec (GAP 1) ─────────────────────────────────────────
  describe('relative duration', () => {
    it('sub-day hour offset is exact (an hour ago)', () => {
      const w = resolveWindow(
        { relativeAmount: 1, relativeUnit: 'hour' },
        now,
        cfg,
      );
      expect(w.from.toISOString()).toBe('2026-06-29T09:00:00.000Z');
      expect(w.to.toISOString()).toBe(now.toISOString());
      expect(w.label).toBe('Past hour');
    });

    it('last 24 hours = exact 24h offset, not a calendar day', () => {
      const w = resolveWindow(
        { relativeAmount: 24, relativeUnit: 'hour' },
        now,
        cfg,
      );
      expect(w.from.toISOString()).toBe('2026-06-28T10:00:00.000Z');
      expect(w.label).toBe('Last 24 hours');
    });

    it('sub-day minute offset is exact', () => {
      const w = resolveWindow(
        { relativeAmount: 30, relativeUnit: 'minute' },
        now,
        cfg,
      );
      expect(w.from.toISOString()).toBe('2026-06-29T09:30:00.000Z');
      expect(w.label).toBe('Last 30 minutes');
    });

    it('last 2 weeks = 14 days back, WAT day-aligned', () => {
      const w = resolveWindow(
        { relativeAmount: 2, relativeUnit: 'week' },
        now,
        cfg,
      );
      expect(w.from.toISOString()).toBe('2026-06-14T23:00:00.000Z'); // 00:00 WAT Jun 15
      expect(w.to.toISOString()).toBe(now.toISOString());
      expect(w.label).toBe('Last 2 weeks');
    });

    it('last 6 months = calendar-month subtraction, WAT day-aligned', () => {
      const w = resolveWindow(
        { relativeAmount: 6, relativeUnit: 'month' },
        now,
        cfg,
      );
      expect(w.from.toISOString()).toBe('2025-12-28T23:00:00.000Z'); // 00:00 WAT Dec 29 2025
      expect(w.label).toBe('Last 6 months');
    });

    it('last year (1 year) is day-aligned and NOT clamped at 400 days', () => {
      const w = resolveWindow(
        { relativeAmount: 1, relativeUnit: 'year' },
        now,
        cfg,
      );
      expect(w.from.toISOString()).toBe('2025-06-28T23:00:00.000Z'); // 00:00 WAT Jun 29 2025
      expect(w.label).toBe('Past year');
      const days = (w.to.getTime() - w.from.getTime()) / 86_400_000;
      expect(days).toBeGreaterThan(365); // would have been clamped under the old 365 cap
    });

    it('explicit from/to takes precedence over a relative spec', () => {
      const w = resolveWindow(
        {
          from: '2026-06-01',
          to: '2026-06-15',
          relativeAmount: 2,
          relativeUnit: 'week',
        },
        now,
        cfg,
      );
      expect(w.label).toBe('Jun 1 – Jun 15, 2026');
    });

    it('relative spec takes precedence over a named period', () => {
      const w = resolveWindow(
        { period: 'today', relativeAmount: 6, relativeUnit: 'month' },
        now,
        cfg,
      );
      expect(w.label).toBe('Last 6 months');
    });

    it('clamps an absurd relative range to maxWindowDays but keeps its label', () => {
      const w = resolveWindow(
        { relativeAmount: 5, relativeUnit: 'year' },
        now,
        cfg,
      );
      const days = (w.to.getTime() - w.from.getTime()) / 86_400_000;
      expect(Math.round(days)).toBe(400);
      expect(w.label).toBe('Last 5 years');
    });

    it('ignores a lone relativeAmount (falls back to default)', () => {
      const w = resolveWindow({ relativeAmount: 3 }, now, cfg);
      expect(w.label).toBe('Last 400 days');
    });
  });
});
