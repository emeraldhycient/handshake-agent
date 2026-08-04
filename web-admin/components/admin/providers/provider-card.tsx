import { Badge } from "@/components/ui/badge"
import { ProviderTestButton } from "@/components/admin/provider-test-button"
import { STATUS_VARIANT } from "@/constants/providers"
import { providerMark } from "@/lib/providers/mark"
import type { ProviderCardViewProps } from "@/types"

import { WarningTriangleIcon } from "./provider-icons"

/**
 * One provider adapter card (design markup lines 6-11) — mark tile + name/kind + a
 * posture-derived status pill, an optional MOCK-MODE banner, an API-KEY PRESENCE row
 * (the value never crosses the boundary — §3.4/§3.5), and the bound-capabilities line.
 * The "Test connection" liveness probe exposes no secret and moves no money (§3.1).
 */
export function ProviderCard({ provider }: ProviderCardViewProps) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      {/* Header: mark + name/kind + status pill (design line 7) */}
      <div className="mb-3 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 flex-none items-center justify-center rounded-[11px] bg-card2 text-sm font-extrabold text-ink"
        >
          {providerMark(provider.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold text-ink">{provider.name}</div>
          <div className="truncate text-[11px] text-ink3">{provider.kind}</div>
        </div>
        <Badge variant={STATUS_VARIANT[provider.status]}>
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-current"
          />
          {provider.status}
          {provider.latencyMs !== null ? ` · ${provider.latencyMs}ms` : ""}
        </Badge>
      </div>

      {/* Optional MOCK-MODE banner (design line 8) */}
      {provider.mock && (
        <div className="mb-2.5 flex items-center gap-2 rounded-[9px] bg-swn px-[11px] py-2">
          <WarningTriangleIcon />
          <span className="text-[11px] font-extrabold tracking-[0.03em] text-twn">
            MOCK MODE ON
          </span>
        </div>
      )}

      {/* API-KEY presence row — the VALUE is never returned (§3.4/§3.5); we show
          only whether the provider's secret is configured (design line 9). */}
      <div className="mb-2.5 flex items-center gap-2.5 rounded-[10px] bg-field px-3 py-[9px]">
        <span className="text-[10.5px] font-bold text-ink3">API KEY</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-ink">
          {provider.hasSecret ? "•••• configured" : "not configured"}
        </span>
        <Badge variant={provider.hasSecret ? "success" : "danger"}>
          {provider.hasSecret ? "present" : "missing"}
        </Badge>
      </div>

      {/* Bound capabilities (design line 10) */}
      <div className="flex items-center gap-3">
        <span className="min-w-0 truncate text-[11px] text-ink3">
          Bound:{" "}
          {provider.capabilities.length > 0
            ? provider.capabilities.join(" · ")
            : "—"}
        </span>
      </div>

      {/* Phase 7: the "Test connection" liveness probe (no secret exposure). */}
      <ProviderTestButton providerKey={provider.key} />
    </div>
  )
}
