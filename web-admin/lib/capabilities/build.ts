import type { EffectiveSetting } from "@handshake-agent/contracts"

import { PRESENTATION } from "@/constants/capabilities"
import type { ResolvedCapability } from "@/types/components"

/**
 * Join the static presentation with the live capability settings: each design row's
 * `on` is the boolean effective value of its `catalog.capabilities.crypto.<x>` key
 * (fail-closed — absent / non-boolean → false, per root §7). Rows whose backing key is
 * missing from the registry response are dropped.
 */
export function buildRows(
  settings: readonly EffectiveSetting[]
): ResolvedCapability[] {
  const byKey = new Map(settings.map((s) => [s.key, s]))
  const rows: ResolvedCapability[] = []
  for (const p of PRESENTATION) {
    const setting = byKey.get(p.settingKey)
    if (!setting) continue
    rows.push({
      id: p.label,
      label: p.label,
      desc: p.desc,
      provider: p.provider,
      on: setting.value === true,
      tone: p.tone,
      icon: p.icon,
      settingKey: p.settingKey,
      scope: setting.scope,
      scopeValue: setting.scopeValue,
    })
  }
  return rows
}
