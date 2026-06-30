/**
 * Pure, deterministic resolver from a query spec to a concrete [from, to] window.
 * Day boundaries are computed in a FIXED-offset local zone (WAT = UTC+1, no DST)
 * so "today"/"this week" mean the user's calendar day, not a UTC day. No I/O,
 * no Date.now() — the caller passes `now` (from CLOCK) so tests are deterministic.
 */

export type RelativeWindowUnit =
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'year';

export interface QueryWindowSpec {
  period?:
    | 'today'
    | 'yesterday'
    | 'this_week'
    | 'last_week'
    | 'this_month'
    | 'last_month'
    | 'all';
  from?: string; // ISO YYYY-MM-DD
  to?: string;
  /**
   * Relative duration ("last 2 weeks" → {2,'week'}). Sub-day units use the exact
   * `now` offset; day+ units keep WAT day-boundary alignment. A lone field is
   * ignored (both must be present). Precedence: from/to → relative → period.
   */
  relativeAmount?: number;
  relativeUnit?: RelativeWindowUnit;
}

export interface WindowConfig {
  maxWindowDays: number;
  timezoneOffsetMinutes: number;
}

export interface StatementWindow {
  from: Date;
  to: Date;
  label: string;
}

const DAY_MS = 86_400_000;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function resolveWindow(
  spec: QueryWindowSpec,
  now: Date,
  cfg: WindowConfig,
): StatementWindow {
  const offsetMs = cfg.timezoneOffsetMinutes * 60_000;
  const maxMs = cfg.maxWindowDays * DAY_MS;

  // A "local" Date whose UTC getters read as WAT wall-clock values.
  const local = (d: Date): Date => new Date(d.getTime() + offsetMs);
  // Build the real UTC instant for given local wall-clock parts.
  const utcFromLocal = (
    y: number,
    m: number,
    d: number,
    h = 0,
    mi = 0,
    s = 0,
    ms = 0,
  ): Date => new Date(Date.UTC(y, m, d, h, mi, s, ms) - offsetMs);

  const ln = local(now);
  const ly = ln.getUTCFullYear();
  const lm = ln.getUTCMonth();
  const ld = ln.getUTCDate();

  const startOfToday = utcFromLocal(ly, lm, ld);
  const endOfDay = (start: Date): Date =>
    new Date(start.getTime() + DAY_MS - 1);

  let from: Date;
  let to: Date;
  let label: string;

  // ── 1. Explicit calendar range takes precedence ──────────────────────────
  const validRange =
    spec.from && spec.to && ISO_DATE.test(spec.from) && ISO_DATE.test(spec.to);
  if (validRange) {
    const [fy, fm, fd] = spec.from!.split('-').map(Number);
    const [ty, tm, td] = spec.to!.split('-').map(Number);
    const f = utcFromLocal(fy, fm - 1, fd);
    const t = endOfDay(utcFromLocal(ty, tm - 1, td));
    if (f.getTime() <= t.getTime()) {
      from = f;
      to = t;
      const lf = local(f);
      const lt = local(t);
      label = `${MONTHS[lf.getUTCMonth()]} ${lf.getUTCDate()} – ${MONTHS[lt.getUTCMonth()]} ${lt.getUTCDate()}, ${lt.getUTCFullYear()}`;
      return clamp({ from, to, label }, now, maxMs);
    }
    // from > to → fall through to default.
  }

  // ── 2. Relative duration (server-computed; the model never picks dates) ───
  // Both fields required; a lone field falls through to the period/default.
  if (spec.relativeAmount && spec.relativeUnit) {
    const n = spec.relativeAmount;
    const u = spec.relativeUnit;

    if (u === 'minute' || u === 'hour') {
      // Sub-day: exact offset from `now`, no day-boundary alignment.
      const unitMs = u === 'minute' ? 60_000 : 3_600_000;
      from = new Date(now.getTime() - n * unitMs);
    } else if (u === 'day') {
      from = utcFromLocal(ly, lm, ld - n);
    } else if (u === 'week') {
      from = utcFromLocal(ly, lm, ld - n * 7);
    } else if (u === 'month') {
      from = utcFromLocal(ly, lm - n, ld);
    } else {
      // year
      from = utcFromLocal(ly - n, lm, ld);
    }
    to = now;
    label = n === 1 ? `Past ${u}` : `Last ${n} ${u}s`;
    return clamp({ from, to, label }, now, maxMs);
  }

  // ── 3. Period enum ───────────────────────────────────────────────────────
  switch (spec.period) {
    case 'today':
      from = startOfToday;
      to = now;
      label = 'Today';
      break;
    case 'yesterday': {
      const startYesterday = utcFromLocal(ly, lm, ld - 1);
      from = startYesterday;
      to = endOfDay(startYesterday);
      label = 'Yesterday';
      break;
    }
    case 'this_week': {
      const dow = local(startOfToday).getUTCDay(); // 0=Sun..6=Sat
      const sinceMonday = (dow + 6) % 7;
      from = utcFromLocal(ly, lm, ld - sinceMonday);
      to = now;
      label = 'This week';
      break;
    }
    case 'last_week': {
      const dow = local(startOfToday).getUTCDay();
      const sinceMonday = (dow + 6) % 7;
      const startThisWeek = utcFromLocal(ly, lm, ld - sinceMonday);
      from = new Date(startThisWeek.getTime() - 7 * DAY_MS);
      to = new Date(startThisWeek.getTime() - 1);
      label = 'Last week';
      break;
    }
    case 'this_month':
      from = utcFromLocal(ly, lm, 1);
      to = now;
      label = 'This month';
      break;
    case 'last_month': {
      const py = lm === 0 ? ly - 1 : ly;
      const pm = lm === 0 ? 11 : lm - 1;
      from = utcFromLocal(py, pm, 1);
      to = new Date(utcFromLocal(ly, lm, 1).getTime() - 1);
      label = 'Last month';
      break;
    }
    case 'all':
    default:
      from = new Date(now.getTime() - maxMs);
      to = now;
      label = `Last ${cfg.maxWindowDays} days`;
      break;
  }

  return clamp({ from, to, label }, now, maxMs);
}

function clamp(w: StatementWindow, now: Date, maxMs: number): StatementWindow {
  let { from, to } = w;
  if (to.getTime() > now.getTime()) to = now;
  if (to.getTime() - from.getTime() > maxMs)
    from = new Date(to.getTime() - maxMs);
  if (from.getTime() > to.getTime()) from = to;
  return { from, to, label: w.label };
}
