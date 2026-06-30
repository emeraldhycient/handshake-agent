// Pure config-merge helpers for the layered config (CLAUDE.md §7). The DB-admin
// `AppSetting` overrides are dot-path keyed (e.g. "pricing.assets.USDT.buySpreadBps");
// these overlay them onto the env/JSON base WITHOUT mutating the base — the base
// AppConfig snapshot must stay stable so concurrent money-path reads are consistent.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function getAtPath(obj: unknown, dotPath: string): unknown {
  let cur: unknown = obj;
  for (const segment of dotPath.split('.')) {
    if (!isObject(cur)) return undefined;
    cur = cur[segment];
  }
  return cur;
}

/**
 * Immutable deep set: returns a new object with `dotPath` set to `value`. Clones
 * only the spine (the objects along the path); untouched siblings are shared by
 * reference. The input is never mutated. Missing intermediate objects are created.
 */
export function setAtPath<T>(obj: T, dotPath: string, value: unknown): T {
  const segments = dotPath.split('.');
  const root: Record<string, unknown> = isObject(obj) ? { ...obj } : {};
  let cursor = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i];
    const child = cursor[key];
    cursor[key] = isObject(child) ? { ...child } : {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
  return root as T;
}

/** Overlay each {key, value} override onto a deep-cloned-along-the-spine base. */
export function applyOverrides<T>(
  base: T,
  overrides: ReadonlyArray<{ key: string; value: unknown }>,
): T {
  return overrides.reduce<T>(
    (acc, { key, value }) => setAtPath(acc, key, value),
    base,
  );
}
