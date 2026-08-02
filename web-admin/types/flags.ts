/** Feature flags page (§6.28). */

// ─── Feature flags page (design §6.28) ─────────────────────────────────────────────
// WIRED to the effective-config registry (`GET /admin/settings`): a registry-backed
// flag (one with a `settingKey`) resolves a REAL effective `on` and exposes a working
// toggle. An UNBACKED flag renders as a read-only "Not yet wired" row — no switch, no
// modal, no fabricated eval/rollout claims.

/**
 * One feature-flag row (design §6.28). `on` drives the toggle track +
 * `eval → on/off` preview (registry-backed rows only); `rollout` is the scope
 * chip label (present only when the flag is actually backed by config).
 */
export interface FeatureFlagRow {
  /** Stable key (also the mono flag key rendered in the row). */
  key: string
  /** One-line description of what the flag gates. */
  desc: string
  /** The scope chip label (e.g. "global · all users"); absent on unbacked rows. */
  rollout?: string
  /** Whether the flag is currently enabled — meaningful only when registry-backed. */
  on: boolean
}

/**
 * A flag definition. `settingKey` bridges the FE flag key → the registry dot-path
 * that backs it; when present, the row's `on` is the real effective value. Rows
 * without a `settingKey` are not registry-backed (rendered read-only, never toggled).
 */
export interface FlagDefinition extends FeatureFlagRow {
  settingKey?: string
}

/**
 * A resolved flag row plus the registry key (if any) that backs it — carried so the
 * write path knows whether it can persist a flip via the settings PATCH. The scope
 * mirrors the backing setting so the override targets the same leaf the read resolved.
 */
export interface ResolvedFlag extends FeatureFlagRow {
  settingKey?: string
  scope: import("@handshake-agent/contracts").EffectiveSetting["scope"]
  scopeValue: string | null
}

/** One flag row — mono key, desc, rollout chip + eval preview, and a 52×30 soft toggle. */
export interface FlagRowProps {
  flag: ResolvedFlag
  onToggle: (flag: ResolvedFlag) => void
}

/** The flag list region — loading skeletons / error+retry / the resolved flag rows. */
export interface FlagsListProps {
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  rows: readonly ResolvedFlag[]
  onToggle: (flag: ResolvedFlag) => void
  onRetry: () => void
}
