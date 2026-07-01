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
 * DATA: this is a PIXEL reproduction — the rows are the design's own module-level
 * mock content (the seed `caps` array, `docs/design-ref/logic.js` lines 113-120):
 * crypto.buy · crypto.sell · send · swap · ticketing.eventbrite · ticketing.tix.
 * No fetching, no TanStack Query. Real-data reintegration is a separate later step.
 *
 * FUNDS-SAFETY: toggling a capability is a KILL-SWITCH. The switch never flips on
 * click — it opens the shared `MakerCheckerModal` (dual-control), so an
 * enable/disable enters Pending approval and requires a second admin before it
 * takes effect, exactly as the design does (root §3.1 model-proposes / §7).
 */
import { useMemo, useState } from "react"

import { MakerCheckerModal } from "@/components/admin/flows"
import { cn } from "@/lib/utils"
import type {
  CapabilityRow,
  CapabilityRowProps,
  CapabilityTone,
} from "@/types/components"

// ─── Design mock content (docs/design-ref/logic.js `caps`, lines 113-120) ────────────

/**
 * The design's six capability rows. Each is bound to a provider port; `on` drives the
 * pill + toggle. Icons are 24×24 stroke-1.8 paths (the design's per-capability marks);
 * `tone` tints the icon tile through a status-token surface/text pair.
 */
const CAPABILITY_ROWS: readonly CapabilityRow[] = [
  {
    id: "crypto.buy",
    label: "crypto.buy",
    desc: "Buy USDT/TRX with NGN",
    provider: "Blockradar",
    on: true,
    tone: "success",
    // coin / currency mark
    icon: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  },
  {
    id: "crypto.sell",
    label: "crypto.sell",
    desc: "Sell crypto to NGN payout",
    provider: "Blockradar + Flutterwave",
    on: true,
    tone: "info",
    // bank / payout mark
    icon: "M4 10h16M4 10l8-6 8 6M6 10v8M10 10v8M14 10v8M18 10v8M4 20h16",
  },
  {
    id: "send",
    label: "send",
    desc: "On-chain transfer to beneficiary",
    provider: "Blockradar",
    on: true,
    tone: "warn",
    // paper-plane mark
    icon: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z",
  },
  {
    id: "swap",
    label: "swap",
    desc: "USDT ↔ TRX swap",
    provider: "Blockradar",
    on: true,
    tone: "info",
    // swap arrows mark
    icon: "M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  },
  {
    id: "ticketing.eventbrite",
    label: "ticketing.eventbrite",
    desc: "Buy event tickets",
    provider: "Eventbrite port",
    on: true,
    tone: "success",
    // ticket mark
    icon: "M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4 2 2 0 0 0 0-4z",
  },
  {
    id: "ticketing.tix",
    label: "ticketing.tix",
    desc: "Alternate ticketing vendor",
    provider: "Tix.Africa port",
    on: false,
    tone: "neutral",
    // ticket mark
    icon: "M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4 2 2 0 0 0 0-4z",
  },
] as const

// The icon tile tint → status-token surface/text utility pair (tokens only).
const TONE_TILE: Record<CapabilityTone, string> = {
  success: "bg-sok text-tok",
  info: "bg-sif text-tif",
  warn: "bg-swn text-twn",
  neutral: "bg-card2 text-ink2",
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

export function CapabilitiesPage() {
  const [pending, setPending] = useState<CapabilityRow | null>(null)

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

      {/* ── Kill-switch rows ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        {CAPABILITY_ROWS.map((row) => (
          <CapabilityRowCard key={row.id} row={row} onToggle={setPending} />
        ))}
      </div>

      {/* ── Maker-checker (kill-switch = dual control) ───────────────────────── */}
      <MakerCheckerModal
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title={
          pending
            ? `${pending.on ? "Disable" : "Enable"} ${pending.label}`
            : "Toggle capability"
        }
        diff={diff}
        onSubmit={() => setPending(null)}
      />
    </div>
  )
}
