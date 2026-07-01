"use client"

/**
 * ReconciliationPage — provider-vs-ledger reconciliation (design §6.12 Recon,
 * docs/design-ref/screens/Recon.html). Pixel-faithful reproduction of the design
 * markup: a cron status bar (last/next run + open-breaks count + "Run now") over a
 * stack of break cards. Each break carries an icon tile, a kind label, a severity
 * pill, a mono link to the offending tx, a signed delta, and — while OPEN — the
 * funds-safety note plus three actions (Escalate to case / Accept / Resolve via
 * engine). A closed break renders the "Resolved" confirmed-outcome footer.
 *
 * DESIGN-ONLY (per the reproduction goal): the cron cadence + break rows are the
 * design's own representative sample content (module-level consts, no fetching —
 * logic.js does not expose this view method). The tx link navigates to the tx-detail
 * route exactly as the design does; the three actions open the shared flow modals
 * (reason → step-up → engine-action) — real reintegration is a separate later step.
 *
 * Funds-safety invariant preserved in the UI (root §3.1): over-credits are flagged
 * for human action, NEVER auto-debited — resolution is engine-brokered, never a raw
 * ledger debit from this surface.
 */
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import {
  EngineActionModal,
  MakerCheckerModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"
import type {
  EngineEffectRow,
  EngineLedgerRow,
  MakerCheckerDiffRow,
  ReconBreak,
  ReconBreakResolution,
  ReconBreakSeverity,
} from "@/types/components"

// design-faithful (no API): the reconciliation cron cadence, exactly as the status
// bar reads in the design markup ("Last run 04:00 · next 04:00 tomorrow").
const CRON_LAST_RUN = "04:00"
const CRON_NEXT_RUN = "04:00 tomorrow"

// Severity → the design's `r.sev` / `r.sevBg` / `r.sevFg` pill (10px/800 uppercase,
// padding 2px 8px, radius 999). Mapped onto the canonical status token pairs (§5):
// high = danger, medium = warn, low = info. Colour is never the sole signal — the
// uppercase label carries severity.
const SEVERITY_META: Record<
  ReconBreakSeverity,
  { label: string; bg: string; fg: string }
> = {
  high: { label: "High", bg: "bg-sdn", fg: "text-tdn" },
  medium: { label: "Medium", bg: "bg-swn", fg: "text-twn" },
  low: { label: "Low", bg: "bg-sif", fg: "text-tif" },
}

/**
 * Per-kind derivations echoing the design's `r.icon` / `r.iconBg` / `r.iconFg`
 * per-row style props. Each kind selects a tinted 36px icon tile + a stroke path.
 */
const KIND_ICON: Record<
  ReconBreak["kind"],
  { path: string; tile: string; fg: string }
> = {
  // Over-credit — a triangle warning (ledger credited more than the provider).
  "Over-credit": {
    path: "M12 8v5M12 16h.01M12 3l9 16H3z",
    tile: "bg-sdn",
    fg: "text-tdn",
  },
  // Missing settlement — a clock (provider confirmed, ledger not yet posted).
  "Missing settlement": {
    path: "M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
    tile: "bg-swn",
    fg: "text-twn",
  },
  // Amount mismatch — opposing arrows (provider and ledger amounts diverge).
  "Amount mismatch": {
    path: "M7 7h10M7 7l3-3M7 7l3 3M17 17H7m10 0-3 3m3-3-3-3",
    tile: "bg-swn",
    fg: "text-twn",
  },
  // Duplicate credit — stacked squares (the same credit landed twice).
  "Duplicate credit": {
    path: "M9 9h10v10H9zM5 5h10v2M5 5v10h2",
    tile: "bg-sif",
    fg: "text-tif",
  },
}

// Delta value tint per the design's `r.deltaFg` — danger for over/duplicate credits,
// warn for mismatches, muted for missing settlements.
const DELTA_TONE: Record<ReconBreak["deltaTone"], string> = {
  danger: "text-tdn",
  warn: "text-twn",
  muted: "text-ink2",
}

// Open-card border echoes the design's `r.cardLine` (a tinted border on open breaks,
// the neutral `--line` once resolved).
const OPEN_CARD_LINE: Record<ReconBreakSeverity, string> = {
  high: "border-sdn",
  medium: "border-swn",
  low: "border-sif",
}

// design-faithful (no API): four representative breaks matching the design's markup
// shapes + the seed() dataset (tx refs, operator-desk phrasing). Over-credits are the
// flagged-for-human class; the last is already resolved (shows the outcome footer).
const RECON_BREAKS: ReconBreak[] = [
  {
    id: "rb_01",
    kind: "Over-credit",
    severity: "high",
    tx: "tx_9f2a41c7",
    detail:
      "Ledger credited 250.00 USDT but Blockradar confirmed 200.00 USDT for this deposit. Excess is flagged for human action — never auto-debited.",
    delta: "+50.00 USDT",
    deltaTone: "danger",
    status: "open",
  },
  {
    id: "rb_02",
    kind: "Missing settlement",
    severity: "medium",
    tx: "tx_3b81e0d4",
    detail:
      "Flutterwave marked the collection settled 46m ago; the matching ledger entry has not posted. Awaiting webhook replay or manual settlement.",
    delta: "-₦185,000",
    deltaTone: "warn",
    status: "open",
  },
  {
    id: "rb_03",
    kind: "Amount mismatch",
    severity: "medium",
    tx: "tx_7c04aa19",
    detail:
      "Provider payout amount (74.90 USDT) differs from the ledger debit (75.00 USDT) after network-fee rounding. Reconcile the 0.10 USDT drift.",
    delta: "+0.10 USDT",
    deltaTone: "warn",
    status: "open",
  },
  {
    id: "rb_04",
    kind: "Duplicate credit",
    severity: "high",
    tx: "tx_a5518f62",
    detail:
      "Two credits of 120.00 USDT posted for a single on-chain deposit. Resolved via engine — the duplicate ledger entry was reversed.",
    delta: "+120.00 USDT",
    deltaTone: "danger",
    status: "closed",
    resolution: "resolved",
  },
]

// Engine-action modal payload for "Resolve via engine" — a design-representative
// itemized effect + double-entry preview for the selected break. The real callsite
// would derive these from the break's tx; here they demonstrate the funds-safety
// path (validation + double-entry + idempotency) the design encodes.
function engineEffect(b: ReconBreak): EngineEffectRow[] {
  return [
    { k: "Transaction", v: b.tx },
    { k: "Break kind", v: b.kind },
    { k: "Provider-vs-ledger delta", v: b.delta },
    { k: "Resolution", v: "Reverse excess ledger entry" },
  ]
}

function engineLedger(b: ReconBreak): EngineLedgerRow[] {
  const amt = b.delta.replace(/^\+/, "")
  return [
    { acct: "user:wallet:usdt", dir: "DR", amt },
    { acct: "recon:adjustment", dir: "CR", amt },
  ]
}

// Maker-checker diff for "Accept" — accepting a break is a dual-control state change
// on the break's disposition, matching the design's from→to change-preview shape.
function acceptDiff(b: ReconBreak): MakerCheckerDiffRow[] {
  return [{ field: `Break ${b.tx}`, from: "Open", to: "Accepted (no debit)" }]
}

/** The three action flows a break card can open. */
type FlowStep =
  | { kind: "resolve"; stage: "reason" | "stepup" | "engine" }
  | { kind: "accept" }
  | { kind: "escalate" }

export function ReconciliationPage() {
  const router = useRouter()
  const [breaks, setBreaks] = useState<ReconBreak[]>(RECON_BREAKS)
  // The break whose flow is currently open + which step of that flow is showing.
  const [active, setActive] = useState<{ id: string; flow: FlowStep } | null>(
    null
  )

  const openCount = useMemo(
    () => breaks.filter((b) => b.status === "open").length,
    [breaks]
  )

  const activeBreak = active
    ? (breaks.find((b) => b.id === active.id) ?? null)
    : null

  function closeFlow() {
    setActive(null)
  }

  // Flip a break to a confirmed outcome (drives the closed-card footer) + close.
  function settle(id: string, resolution: ReconBreakResolution) {
    setBreaks((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, status: "closed", resolution } : b
      )
    )
    closeFlow()
  }

  return (
    <div
      data-screen-label="Reconciliation"
      className="mx-auto max-w-[1120px] px-[30px] pt-[26px] pb-[60px]"
    >
      {/* Header block */}
      <div className="mb-4">
        <h1 className="m-0 text-2xl font-extrabold tracking-[-0.02em]">
          Reconciliation
        </h1>
        <p className="mt-[5px] mb-0 text-[13.5px] text-ink2">
          Provider-vs-ledger breaks. Over-credits are flagged for human action —
          never auto-debited.
        </p>
      </div>

      {/* Cron status bar */}
      <div className="mb-4 flex flex-wrap items-center gap-[14px] rounded-[14px] border border-line bg-card px-[18px] py-[14px]">
        <div className="flex items-center gap-[9px]">
          <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-sok text-tok">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <div className="text-[12.5px] font-bold">Reconciliation cron</div>
            <div className="text-[11px] text-ink3">
              Last run {CRON_LAST_RUN} · next {CRON_NEXT_RUN} ·{" "}
              <span className="tabular-nums">{openCount}</span> open breaks
            </div>
          </div>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => router.refresh()}
          className="flex h-9 items-center gap-[7px] rounded-[10px] border border-line bg-card px-[15px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d="M6 4l14 8-14 8z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
          Run now
        </button>
      </div>

      {/* Break cards */}
      <div className="flex flex-col gap-3">
        {breaks.map((b) => {
          const icon = KIND_ICON[b.kind]
          const sev = SEVERITY_META[b.severity]
          const isOpen = b.status === "open"
          return (
            <div
              key={b.id}
              className={cn(
                "rounded-2xl border bg-card px-5 py-4",
                isOpen ? OPEN_CARD_LINE[b.severity] : "border-line"
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "flex size-9 flex-none items-center justify-center rounded-[10px]",
                    icon.tile,
                    icon.fg
                  )}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d={icon.path}
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-[9px]">
                    <span className="text-sm font-bold">{b.kind}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase",
                        sev.bg,
                        sev.fg
                      )}
                    >
                      {sev.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => router.push(`/transactions/${b.tx}`)}
                      className="font-mono text-[11px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {b.tx}
                    </button>
                  </div>
                  <div className="mt-1 text-[12.5px] leading-[1.45] text-ink2">
                    {b.detail}
                  </div>
                </div>
                <div className="flex-none text-right">
                  <div className="text-[10px] font-bold text-ink3 uppercase">
                    Delta
                  </div>
                  <div
                    className={cn(
                      "font-mono text-sm font-extrabold tabular-nums",
                      DELTA_TONE[b.deltaTone]
                    )}
                  >
                    {b.delta}
                  </div>
                </div>
              </div>

              {isOpen ? (
                <div className="mt-3.5 flex items-center gap-[9px] border-t border-line2 pt-3.5">
                  <div className="flex flex-1 items-center gap-1.5 text-[11px] text-ink3">
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="M12 8v5M12 16h.01M12 3l9 16H3z"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Resolution is engine-brokered · never a raw debit.
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setActive({ id: b.id, flow: { kind: "escalate" } })
                    }
                    className="rounded-[9px] border border-line px-3.5 py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    Escalate to case
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setActive({ id: b.id, flow: { kind: "accept" } })
                    }
                    className="rounded-[9px] border border-line px-3.5 py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setActive({
                        id: b.id,
                        flow: { kind: "resolve", stage: "reason" },
                      })
                    }
                    className="rounded-[9px] bg-brand-green px-4 py-2 text-xs font-extrabold text-white transition-colors hover:bg-brand-green/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    Resolve via engine
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-[7px] text-xs font-bold text-tok">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="m5 12 5 5L20 7"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Resolved
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Flow modals (shared) ──────────────────────────────────────────────
          Escalate → reason (audit) → open a compliance case.
          Accept   → maker-checker (dual-control state change, no debit).
          Resolve  → reason → step-up TOTP → engine-action (double-entry + idem). */}
      {activeBreak && (
        <>
          {/* Escalate: reason only → escalated outcome */}
          <ReasonModal
            open={active?.flow.kind === "escalate"}
            onOpenChange={(o) => !o && closeFlow()}
            title={`Escalate ${activeBreak.tx} to case`}
            onContinue={() => settle(activeBreak.id, "escalated")}
          />

          {/* Accept: maker-checker dual-control → accepted outcome */}
          <MakerCheckerModal
            open={active?.flow.kind === "accept"}
            onOpenChange={(o) => !o && closeFlow()}
            title={`Accept break ${activeBreak.tx}`}
            diff={acceptDiff(activeBreak)}
            onSubmit={() => settle(activeBreak.id, "accepted")}
          />

          {/* Resolve via engine: reason → step-up → engine-action */}
          <ReasonModal
            open={
              active?.flow.kind === "resolve" && active.flow.stage === "reason"
            }
            onOpenChange={(o) => !o && closeFlow()}
            title={`Resolve ${activeBreak.tx} via engine`}
            onContinue={() =>
              setActive({
                id: activeBreak.id,
                flow: { kind: "resolve", stage: "stepup" },
              })
            }
          />
          <StepUpModal
            open={
              active?.flow.kind === "resolve" && active.flow.stage === "stepup"
            }
            onOpenChange={(o) => !o && closeFlow()}
            title={`resolve ${activeBreak.tx}`}
            onComplete={() =>
              setActive({
                id: activeBreak.id,
                flow: { kind: "resolve", stage: "engine" },
              })
            }
          />
          <EngineActionModal
            open={
              active?.flow.kind === "resolve" && active.flow.stage === "engine"
            }
            onOpenChange={(o) => !o && closeFlow()}
            title={`Resolve ${activeBreak.kind.toLowerCase()}`}
            effect={engineEffect(activeBreak)}
            ledger={engineLedger(activeBreak)}
            idempotencyKey={`recon-${activeBreak.id}-resolve`}
            cta="Resolve via engine"
            onExecute={() => settle(activeBreak.id, "resolved")}
          />
        </>
      )}
    </div>
  )
}
