"use client"

/**
 * CapabilitiesPage — the Capabilities / service-registry master switchboard
 * (operator-console design §6.25), rebuilt 1:1 against
 * `docs/design-ref/screens/Capabilities.html`.
 *
 * Layout: a centered `max-w-[1000px]` column — a title + subtitle header, then a
 * `flex-col gap-3` stack of full-width kill-switch rows. Each row is a
 * `rounded-[16px]` card: a tinted 42px icon tile, a mono capability label + an
 * ENABLED/DISABLED status pill, a `desc · port` line, and a trailing 52px soft
 * toggle.
 *
 * WIRED (Phase 6a): the crypto capability rows' ENABLED/DISABLED state is REAL —
 * resolved from the `catalog.capabilities.crypto.{buy,sell,send,swap}` boolean
 * registry keys via GET /admin/settings (`useSettings("Catalog")`). The per-row
 * presentation metadata the design shows — human description, bound provider port,
 * icon, and tint — is NOT modeled by the config contract, so it stays as static
 * design-faithful presentation keyed by capability id (see PRESENTATION + shapeGaps).
 * The two ticketing-vendor rows (eventbrite / tix) have NO per-vendor registry key
 * (only a single global `ticketing.enabled`), so they are omitted here and recorded
 * as a shapeGap. Four async branches: loading / error / empty / data.
 *
 * FUNDS-SAFETY: toggling a capability is a KILL-SWITCH. The switch never flips on
 * click — it opens the shared `MakerCheckerModal` (dual-control). WIRED (Phase 7 —
 * WRITE): the maker-checker submit calls the real step-up-guarded PATCH
 * /admin/settings/:key (`useSetSetting`) to flip the `catalog.capabilities.crypto.<x>`
 * boolean, which re-validates + hot-reloads + audits `config_change` server-side; the
 * settings query then invalidates so the row re-resolves. A 403 ADMIN_STEP_UP_REQUIRED
 * opens the StepUpDialog and the PATCH replays after re-auth (`useStepUpRetry`).
 * Nothing moves money (§3.1).
 */
import { useMemo, useState } from "react"

import type { EffectiveSetting } from "@handshake-agent/contracts"

import { MakerCheckerModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/client"
import { pushToast } from "@/lib/store/toast-store"
import { useAdminMe, useSetSetting, useSettings } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { cn } from "@/lib/utils"
import type {
  CapabilityRow,
  CapabilityRowProps,
  CapabilityTone,
} from "@/types/components"

// ─── Static presentation metadata (design §6.25) ─────────────────────────────────────

/**
 * Per-capability display metadata the config contract does NOT provide — the human
 * label, description, bound provider port, icon path, and icon-tile tint. Keyed by
 * the crypto capability leaf so each real boolean setting joins its design row.
 * `on` is NOT here — it comes from the live setting value.
 */
interface CapabilityPresentation {
  /** The `catalog.capabilities.crypto.<x>` registry key backing this row. */
  settingKey: string
  label: string
  desc: string
  provider: string
  tone: CapabilityTone
  icon: string
}

const PRESENTATION: readonly CapabilityPresentation[] = [
  {
    settingKey: "catalog.capabilities.crypto.buy",
    label: "crypto.buy",
    desc: "Buy USDT/TRX with NGN",
    provider: "Blockradar",
    tone: "success",
    // coin / currency mark
    icon: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  },
  {
    settingKey: "catalog.capabilities.crypto.sell",
    label: "crypto.sell",
    desc: "Sell crypto to NGN payout",
    provider: "Blockradar + Flutterwave",
    tone: "info",
    // bank / payout mark
    icon: "M4 10h16M4 10l8-6 8 6M6 10v8M10 10v8M14 10v8M18 10v8M4 20h16",
  },
  {
    settingKey: "catalog.capabilities.crypto.send",
    label: "send",
    desc: "On-chain transfer to beneficiary",
    provider: "Blockradar",
    tone: "warn",
    // paper-plane mark
    icon: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z",
  },
  {
    settingKey: "catalog.capabilities.crypto.swap",
    label: "swap",
    desc: "USDT ↔ TRX swap",
    provider: "Blockradar",
    tone: "info",
    // swap arrows mark
    icon: "M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  },
] as const

// The icon tile tint → status-token surface/text utility pair (tokens only).
const TONE_TILE: Record<CapabilityTone, string> = {
  success: "bg-sok text-tok",
  info: "bg-sif text-tif",
  warn: "bg-swn text-twn",
  neutral: "bg-card2 text-ink2",
}

/**
 * A resolved capability row plus the registry key + scope that back it — carried so
 * the write path targets the same leaf the read resolved.
 */
interface ResolvedCapability extends CapabilityRow {
  settingKey: string
  scope: EffectiveSetting["scope"]
  scopeValue: string | null
}

/**
 * Join the static presentation with the live capability settings: each design row's
 * `on` is the boolean effective value of its `catalog.capabilities.crypto.<x>` key
 * (fail-closed — absent / non-boolean → false, per root §7). Rows whose backing key
 * is missing from the registry response are dropped.
 */
function buildRows(
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

// ─── Sub-component ───────────────────────────────────────────────────────────────────

/**
 * One capability kill-switch row (design §6.25 markup): a tinted 42px icon tile, the
 * mono label + an ENABLED/DISABLED pill, a `desc · port` line, and a 52px soft toggle.
 * The toggle is a button (not a live switch) — clicking it opens the maker-checker
 * modal rather than flipping state directly.
 */
function CapabilityRowCard({ row, onToggle }: CapabilityRowProps) {
  const labelId = `capability-${row.id}`
  return (
    <div className="flex items-center gap-4 rounded-[16px] border border-line bg-card px-5 py-4">
      {/* Icon tile (design-faithful tint) — width:42; height:42; radius:11 */}
      <span
        className={cn(
          "flex size-[42px] flex-none items-center justify-center rounded-[11px]",
          TONE_TILE[row.tone]
        )}
        aria-hidden="true"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d={row.icon}
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      {/* Label + status pill + desc/port */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[9px]">
          <span
            id={labelId}
            className="font-mono text-[14px] font-extrabold text-ink"
          >
            {row.label}
          </span>
          <span
            className={cn(
              "rounded-full px-[9px] py-0.5 text-[10.5px] font-bold",
              row.on ? "bg-sok text-tok" : "bg-sdn text-tdn"
            )}
          >
            {row.on ? "ENABLED" : "DISABLED"}
          </span>
        </div>
        <div className="mt-[3px] text-[12px] text-ink3">
          {row.desc} · port: {row.provider}
        </div>
      </div>

      {/* Kill-switch toggle — width:52; height:30; knob 24; opens maker-checker */}
      <button
        type="button"
        role="switch"
        aria-checked={row.on}
        aria-labelledby={labelId}
        onClick={() => onToggle(row)}
        className={cn(
          "relative h-[30px] w-[52px] flex-none rounded-full transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          row.on ? "bg-brand-green" : "bg-card2"
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] size-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-[left]",
            row.on ? "left-[25px]" : "left-[3px]"
          )}
        />
      </button>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────────────

/** Normalizes a mutation/step-up failure into a user-facing message. */
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "Something went wrong."
}

export function CapabilitiesPage() {
  const query = useSettings("Catalog")
  const rows = useMemo(() => buildRows(query.data ?? []), [query.data])

  const me = useAdminMe()
  const setSetting = useSetSetting()
  const stepUp = useStepUpRetry()

  // Which capability's toggle is pending dual-control approval (drives the modal +
  // write). Held by id so the resolved row (with its setting key) is re-derived.
  const [pendingId, setPendingId] = useState<string | null>(null)
  const pending = rows.find((r) => r.id === pendingId) ?? null

  // The from→to change preview for the maker-checker modal (design's diff table).
  const diff = useMemo(() => {
    if (!pending) return []
    return [
      {
        field: `capability: ${pending.label}`,
        from: pending.on ? "Enabled" : "Disabled",
        to: pending.on ? "Disabled" : "Enabled",
      },
    ]
  }, [pending])

  /**
   * Approve the kill-switch flip. Persists the new boolean via the real step-up-guarded
   * PATCH /admin/settings/:key (`useSetSetting`) — the server re-validates the catalog
   * multi-currency invariant + hot-reloads + audits `config_change`; the settings query
   * then invalidates so the row re-resolves. A 403 ADMIN_STEP_UP_REQUIRED opens the
   * StepUpDialog and the PATCH replays after re-auth. Nothing moves money (§3.1).
   */
  const approveToggle = () => {
    if (!pending) return
    const cap = pending
    const enabling = !cap.on
    setPendingId(null)
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          setSetting
            .mutateAsync({
              key: cap.settingKey,
              input: {
                value: enabling,
                scope: cap.scope,
                scopeValue: cap.scopeValue,
              },
            })
            .then(() => undefined)
        )
        if (ok)
          pushToast(
            `${cap.label} ${enabling ? "enabled" : "disabled"}`,
            enabling ? "ok" : "warn"
          )
      } catch (error) {
        pushToast(errorMessage(error), "warn")
      }
    })()
  }

  return (
    <div className="mx-auto w-full max-w-[1000px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Capabilities / service registry
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Master switchboard. Each capability is bound to a provider port.
          Toggling is a kill-switch — maker-checker with dependency warnings.
        </p>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {query.isLoading && (
        <div className="flex flex-col gap-3" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[74px] rounded-[16px]" />
          ))}
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {query.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn/40 p-6 text-center">
          <p className="text-sm font-bold text-tdn">
            Failed to load capabilities
          </p>
          <p className="mt-1 text-[12.5px] text-ink2">
            The capability registry could not be read.
          </p>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="mt-3 inline-flex items-center rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────────── */}
      {query.isSuccess && rows.length === 0 && (
        <div className="rounded-[16px] border border-line bg-card p-6 text-center">
          <p className="text-sm font-bold text-ink">No capabilities</p>
          <p className="mt-1 text-[12.5px] text-ink3">
            No capability flags are registered.
          </p>
        </div>
      )}

      {/* ── Kill-switch rows (data) ──────────────────────────────────────────── */}
      {query.isSuccess && rows.length > 0 && (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <CapabilityRowCard
              key={row.id}
              row={row}
              onToggle={(r) => setPendingId(r.id)}
            />
          ))}
        </div>
      )}

      {/* ── Maker-checker (kill-switch = dual control) ───────────────────────── */}
      <MakerCheckerModal
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPendingId(null)
        }}
        title={
          pending
            ? `${pending.on ? "Disable" : "Enable"} ${pending.label}`
            : "Toggle capability"
        }
        diff={diff}
        onSubmit={approveToggle}
      />

      {/* Server-side step-up re-auth: a 403 on the capability PATCH opens this; the
          PATCH replays after re-authentication (settings then invalidate). */}
      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .then(() => undefined)
            .catch((error) => pushToast(errorMessage(error), "warn"))
        }}
      />
    </div>
  )
}
