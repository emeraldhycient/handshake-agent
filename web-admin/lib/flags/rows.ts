import type { EffectiveSetting } from "@handshake-agent/contracts"

import { FLAG_DEFS } from "@/constants/flags"
import type { MakerCheckerDiffRow, ResolvedFlag } from "@/types"

/**
 * Resolve each flag's effective `on`: a registry-backed flag takes the boolean value
 * of its backing setting (fail-closed — absent / non-boolean → false); an unbacked
 * flag keeps its design-faithful default. Carries the backing key + scope for the
 * write path.
 */
export function resolveFlags(
  settings: readonly EffectiveSetting[]
): ResolvedFlag[] {
  const byKey = new Map(settings.map((s) => [s.key, s]))
  return FLAG_DEFS.map((def) => {
    const backing = def.settingKey ? byKey.get(def.settingKey) : undefined
    const on = backing ? backing.value === true : def.on
    return {
      key: def.key,
      desc: def.desc,
      rollout: def.rollout,
      on,
      settingKey: def.settingKey,
      scope: backing?.scope ?? "global",
      scopeValue: backing?.scopeValue ?? null,
    }
  })
}

/** The one-line maker-checker diff for flipping a flag's enabled state. */
export function toggleDiff(flag: ResolvedFlag | null): MakerCheckerDiffRow[] {
  if (!flag) return []
  return [
    {
      field: `${flag.key} · enabled`,
      from: flag.on ? "on" : "off",
      to: flag.on ? "off" : "on",
    },
  ]
}
