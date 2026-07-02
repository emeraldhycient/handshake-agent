"use client"

/**
 * ProvidersPage — the provider-adapters operator screen (design §6.27), WIRED to
 * the real provider-registry read endpoint (`GET /admin/providers`, Phase 6b) via
 * `useProviderRegistry()`.
 *
 * Layout: a `1fr 1fr` grid of provider cards (mark tile + name/kind + status pill;
 * an optional amber MOCK-MODE banner; an API-KEY presence row; a bound-capabilities
 * line), then a full-width "Mock → live readiness checklist" card of check-icon
 * rows. Each card's status is DERIVED server-side from configuration posture
 * (mock-mode + secret presence), and every readiness gate is computed from a real
 * config signal.
 *
 * FUNDS-SAFETY / SECRETS: the API returns secret-PRESENCE booleans only — the key
 * VALUES never cross the boundary (root CLAUDE.md §3.4/§3.5), so this screen shows
 * whether each provider's key is configured, never the key itself. There is no
 * reveal of a real secret. Phase 7 adds the wired "Test connection" liveness probe
 * (ProviderTestButton) — a real, credential-free reachability check that exposes NO
 * secret and moves NO money (§3.1). Reads stay read-only; the probe is step-up-gated.
 */
import type {
  ProviderCardView,
  ProviderRegistryStatus,
} from "@handshake-agent/contracts"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ProviderTestButton } from "@/components/admin/provider-test-button"
import { useProviderRegistry } from "@/lib/query/hooks"
import type { ProviderCardViewProps } from "@/types/components"

// Provider status word → the canonical status→token pill variant (§5). Colour is
// never the sole signal — the status word text carries the state. `degraded` is
// reserved for a future live probe (Phase 7); the read endpoint emits only the
// posture-derived ok / down / mock today, but the map stays exhaustive.
const STATUS_VARIANT: Record<
  ProviderRegistryStatus,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  ok: "success",
  degraded: "warn",
  down: "danger",
  mock: "info",
}

/** The 2-letter mark shown in a provider's rounded tile (initials of the name). */
function providerMark(name: string): string {
  const words = name.trim().split(/\s+/)
  const first = words[0]?.[0] ?? ""
  const second = words[1]?.[0] ?? words[0]?.[1] ?? ""
  return (first + second).toUpperCase()
}

// ─── Icons (inline stroke SVG, matching the design's 24×24 paths) ───────────────────

function WarningTriangleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-twn"
    >
      <path
        d="M12 4l9 16H3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The readiness-row glyph — a check when done, a dash while pending. */
function ReadinessIcon({ done }: { done: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={done ? "M5 12l5 5L20 7" : "M6 12h12"}
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ─── Provider card (design markup lines 6-11) ───────────────────────────────────────

function ProviderCardView({ provider }: ProviderCardViewProps) {
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

// ─── Readiness checklist (design markup lines 14-17) ────────────────────────────────

function ReadinessCard({
  items,
}: {
  items: readonly { key: string; label: string; done: boolean }[]
}) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Mock → live readiness checklist
      </div>
      {items.length === 0 ? (
        <p className="py-2 text-[12.5px] text-ink3">
          No readiness signals available.
        </p>
      ) : (
        items.map((item) => (
          <div
            key={item.key}
            className="flex items-center gap-[11px] border-b border-line2 py-2 last:border-b-0"
          >
            <span
              aria-hidden="true"
              className={`flex size-5 flex-none items-center justify-center rounded-md ${
                item.done ? "bg-sok text-tok" : "bg-card2 text-ink3"
              }`}
            >
              <ReadinessIcon done={item.done} />
            </span>
            <span className="text-[12.5px] font-semibold text-ink2">
              {item.label}
            </span>
            <span className="sr-only">{item.done ? "done" : "pending"}</span>
          </div>
        ))
      )}
    </div>
  )
}

// ─── Loading / error skeletons ──────────────────────────────────────────────────────

function ProviderCardSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 flex items-center gap-3" aria-busy="true">
        <Skeleton className="size-10 flex-none rounded-[11px]" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-2.5 w-40" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="mb-2.5 h-9 w-full rounded-[10px]" />
      <Skeleton className="h-3 w-48" />
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────────────

export function ProvidersPage() {
  const query = useProviderRegistry()

  return (
    <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header (design markup line 3) ──────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Providers
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Provider adapters per capability. Status is derived from configuration
          posture; API keys are never revealed — only their presence is shown.
        </p>
      </div>

      {/* Error branch (§5) */}
      {query.isError && (
        <div className="mb-4 rounded-xl border border-sdn bg-sdn/40 px-4 py-3.5 text-center">
          <p className="text-xs font-bold text-tdn">
            Couldn&apos;t load the provider registry
          </p>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="mt-1.5 cursor-pointer rounded-md px-1.5 text-[11.5px] font-bold text-tif hover:bg-hov focus-visible:outline focus-visible:outline-2 focus-visible:outline-tif"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading branch (§5) */}
      {query.isLoading && (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          <ProviderCardSkeleton />
          <ProviderCardSkeleton />
          <ProviderCardSkeleton />
          <ProviderCardSkeleton />
        </div>
      )}

      {/* Data / empty branches (§5) */}
      {query.data && (
        <>
          {query.data.providers.length === 0 ? (
            <div className="mb-4 rounded-2xl border border-line bg-card px-5 py-8 text-center">
              <p className="text-[12.5px] text-ink3">
                No provider adapters registered.
              </p>
            </div>
          ) : (
            <div className="mb-4 grid grid-cols-1 gap-3.5 md:grid-cols-2">
              {query.data.providers.map((provider: ProviderCardView) => (
                <ProviderCardView key={provider.key} provider={provider} />
              ))}
            </div>
          )}

          <ReadinessCard items={query.data.readiness} />
        </>
      )}
    </div>
  )
}
