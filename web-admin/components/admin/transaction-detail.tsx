"use client"

/**
 * TransactionDetail — pixel-faithful reproduction of the design's transaction
 * record screen (`docs/design-ref/screens/TxDetail.html`, `pTxDetail`). Reached
 * by drilling into a Transactions row (`/transactions/[id]`).
 *
 * This is a DESIGN reproduction, not a data-wired screen: the values come from
 * the design's own `vTxDetail()` + `seed()` mock logic (docs/design-ref/logic.js
 * lines 46-72 + 696-742), translated to module-level constants below so the page
 * renders the exact values the design shows. Real-data reintegration is a
 * separate later step — there are no query hooks here.
 *
 * Layout (1:1 with the markup + its inline styles):
 *  - back-link "All transactions"
 *  - header: `{type} · {amount}` title + status pill + copyable mono id, plus an
 *    action-button row (`txActions`) of engine-brokered triage actions
 *  - a `1.15fr / 1fr` grid:
 *      left  → Itemized parameters (as confirmed to user; operator-only margin
 *              note) + Double-entry ledger mini-table (Account/Dir/Amount/Seq,
 *              "Open ledger →")
 *      right → Engine state timeline (vertical stepper) + Provider references
 *              (label + mono value + copy + external link) + Webhook history
 *
 * Funds-safety (§3.1): every action button opens the shared flow modals from the
 * Shared phase in the same sequence the design uses (reason → step-up → engine,
 * with a maker-checker branch on large refunds). The modals only propose; they
 * never move money here.
 */
import { useMemo, useState } from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"
import { StatusPill } from "@/components/admin/status-pill"
import {
  EngineActionModal,
  MakerCheckerModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"
import type {
  EngineLedgerRow,
  MakerCheckerDiffRow,
  StatusPillStatus,
  TransactionDetailProps,
} from "@/types/components"

// ─── Design mock data (translated from vTxDetail() + seed(), logic.js) ─────────────
// The design's `curTx()` falls back to the first `pending_settlement` transaction
// (seed index i=4). Its computed fields are reproduced verbatim so the screen
// renders exactly what the design shows.

const NGN = (n: number): string =>
  "₦" +
  Number(n).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

// The representative transaction (seed i=4 → forced pending_settlement).
const TX = {
  id: "tx_80283",
  type: "receive",
  userId: "usr_10508",
  user: "Ifeoma Eze",
  asset: "USDT",
  usdt: 236.599531,
  ngn: 251904.85,
  rate: 1064.6887,
  status: "pending_settlement" as StatusPillStatus,
  flwRef: "MockFLWRef-902412",
  chainHash: "TJ173305038490070x9",
  blockradar: "br_dep_55246",
  idem: "idem_15020323",
  created: "Jul 1 · 13:28",
  fee: 3022.86,
  spreadBps: 85,
} as const

const MARGIN = Math.round(TX.ngn * 0.0085 * 100) / 100 // 2141.19

// ── Itemized parameters (as confirmed to user); margin is operator-only ──────────
interface ParamRow {
  k: string
  v: string
  /** operator-only margin row tints warn (--twn); the rest use --ink. */
  warn?: boolean
}
const PARAMS: ParamRow[] = [
  { k: "Amount", v: TX.usdt.toFixed(6) + " USDT" },
  { k: "Fiat leg", v: NGN(TX.ngn) },
  { k: "Rate (spread-folded)", v: "₦" + TX.rate.toFixed(4) },
  { k: "Processing fee", v: NGN(TX.fee) },
  { k: "FX spread", v: TX.spreadBps + " bps" },
  { k: "Internal margin (operator)", v: NGN(MARGIN), warn: true },
]

// ── Double-entry ledger (Account / Dir / Amount / Seq) ───────────────────────────
interface LedgerRow {
  acct: string
  dir: "DEBIT" | "CREDIT"
  amt: string
  seq: string
}
const SEQ = (n: number): string => "44" + (n + TX.id.length) // id.length = 8
const LEDGER: LedgerRow[] = [
  {
    acct: "user:" + TX.userId + ":NGN",
    dir: "DEBIT",
    amt: NGN(TX.ngn),
    seq: SEQ(920),
  },
  {
    acct: "treasury:USDT",
    dir: "DEBIT",
    amt: TX.usdt.toFixed(6),
    seq: SEQ(921),
  },
  {
    acct: "user:" + TX.userId + ":USDT",
    dir: "CREDIT",
    amt: TX.usdt.toFixed(6),
    seq: SEQ(922),
  },
  { acct: "revenue:fees:NGN", dir: "CREDIT", amt: NGN(TX.fee), seq: SEQ(923) },
]

// ── Engine state timeline (pending_settlement variant) ───────────────────────────
type TimelineTone = "done" | "pending" | "fail"
interface TimelineStep {
  label: string
  time: string
  tone: TimelineTone
  /** whether a connector line drops to the next step. */
  line: boolean
}
const TIMELINE: TimelineStep[] = [
  { label: "Initiated", time: TX.created, tone: "done", line: true },
  { label: "Quoted", time: "+0.4s", tone: "done", line: true },
  {
    label: "Directive · PIN + step-up",
    time: "+2.1s",
    tone: "done",
    line: true,
  },
  { label: "Execution submitted", time: "+2.6s", tone: "done", line: true },
  {
    label: "Settlement by webhook",
    time: "awaiting…",
    tone: "pending",
    line: false,
  },
]

// tone → { dot bg/fg, label fg, icon path } (logic.js done/pend/fail, lines 710-712).
const TIMELINE_TONE: Record<
  TimelineTone,
  { dotBg: string; dotFg: string; fg: string; icon: string }
> = {
  done: {
    dotBg: "bg-[#1f8a5b]",
    dotFg: "text-white",
    fg: "text-ink",
    icon: "m5 12 5 5L20 7",
  },
  pending: {
    dotBg: "bg-swn",
    dotFg: "text-twn",
    fg: "text-twn",
    icon: "M12 7v5l3 2",
  },
  fail: {
    dotBg: "bg-sdn",
    dotFg: "text-tdn",
    fg: "text-tdn",
    icon: "M6 6l12 12M18 6L6 18",
  },
}

// ── Provider references (label + mono value + copy + optional external link) ──────
interface RefRow {
  label: string
  value: string
  link?: string
  href?: string
}
const REFS: RefRow[] = [
  {
    label: "TRON",
    value: TX.chainHash,
    link: "Tronscan",
    href: "https://tronscan.org/#/transaction/" + TX.chainHash,
  },
  { label: "Flutterwave", value: TX.flwRef },
  { label: "Blockradar", value: TX.blockradar },
  { label: "Idempotency", value: TX.idem },
]

// ── Webhook history (pending_settlement variant, logic.js line 732) ──────────────
interface WebhookRow {
  event: string
  time: string
  /** green (delivered) vs amber (in-flight) dot. */
  tone: "ok" | "warn"
}
const WEBHOOKS: WebhookRow[] = [
  { event: "blockradar.deposit.detected", time: TX.created, tone: "ok" },
  { event: "flutterwave.settlement.pending", time: "+1s", tone: "warn" },
]

// ── Header action buttons (txActions, logic.js lines 736-741) ────────────────────
type FlowKind = "retry" | "refund" | "markFailed" | "recon" | "receipt"
interface ActionButton {
  label: string
  /** the flow this action opens; `receipt` is a no-op toast in the design. */
  kind: FlowKind
  icon: string
  danger?: boolean
}
// Reproduced for the pending_settlement status: retry appears, mark-failed appears.
const TX_ACTIONS: ActionButton[] = [
  {
    label: "Retry settlement",
    kind: "retry",
    icon: "M4 12a8 8 0 1 1 2.3 5.6M4 20v-4h4",
  },
  {
    label: "Refund",
    kind: "refund",
    icon: "M4 12a8 8 0 1 1 2.3 5.6M4 20v-4h4",
  },
  {
    label: "Mark failed",
    kind: "markFailed",
    icon: "M6 6l12 12M18 6L6 18",
    danger: true,
  },
  { label: "Re-run recon", kind: "recon", icon: "M12 4v16M4 20h16" },
  { label: "Resend receipt", kind: "receipt", icon: "M4 4h16v12H8l-4 4z" },
]

// ── Flow-step context per action (mirrors runFlow ctx, logic.js 668-681) ─────────
type FlowStep = "reason" | "stepup" | "engine" | "maker"
interface FlowSpec {
  steps: FlowStep[]
  title: string
  cta: string
  effect: { k: string; v: string }[]
  ledger: EngineLedgerRow[]
  diff?: MakerCheckerDiffRow[]
}

// A partial refund is half the fiat leg; over ₦100,000 it adds a maker-checker
// step (design refundTx, logic.js line 673-674).
const REFUND_HALF = Math.round((TX.ngn / 2) * 100) / 100 // ₦125,952.42 → maker branch
const REFUND_BIG = REFUND_HALF > 100000

function flowSpecFor(kind: FlowKind): FlowSpec | null {
  switch (kind) {
    case "retry":
      return {
        steps: ["stepup", "engine"],
        title: "Retry settlement",
        cta: "Execute retry via engine",
        effect: [
          { k: "Transaction", v: TX.id },
          { k: "Directive", v: "settlement.retry" },
          { k: "Amount", v: TX.usdt.toFixed(6) + " USDT" },
          { k: "≈ Fiat", v: NGN(TX.ngn) },
        ],
        ledger: [
          { acct: "float:USDT", dir: "DR", amt: TX.usdt.toFixed(6) },
          { acct: TX.userId + ":USDT", dir: "CR", amt: TX.usdt.toFixed(6) },
        ],
      }
    case "refund":
      return {
        steps: REFUND_BIG
          ? ["reason", "stepup", "engine", "maker"]
          : ["reason", "stepup", "engine"],
        title: "Refund (partial) · " + NGN(REFUND_HALF),
        cta: "Execute refund via engine",
        diff: [
          {
            field: "Refund amount · " + TX.id,
            from: "₦0.00",
            to: NGN(REFUND_HALF),
          },
        ],
        effect: [
          { k: "Original tx", v: TX.id },
          { k: "Refund amount", v: NGN(REFUND_HALF) },
          { k: "Type", v: "partial" },
          { k: "Beneficiary", v: TX.user },
        ],
        ledger: [
          { acct: "treasury:NGN", dir: "DR", amt: NGN(REFUND_HALF) },
          { acct: TX.userId + ":NGN", dir: "CR", amt: NGN(REFUND_HALF) },
        ],
      }
    case "markFailed":
      return {
        steps: ["reason", "stepup", "engine"],
        title: "Mark failed",
        cta: "Mark failed via engine",
        effect: [
          { k: "Transaction", v: TX.id },
          { k: "Directive", v: "mark_failed" },
          { k: "Reversal", v: NGN(TX.ngn) },
        ],
        ledger: [
          { acct: TX.userId + ":NGN", dir: "DR", amt: NGN(TX.ngn) },
          { acct: "suspense:NGN", dir: "CR", amt: NGN(TX.ngn) },
        ],
      }
    case "recon":
      return {
        steps: ["stepup"],
        title: "Re-run reconciliation",
        cta: "Execute via engine",
        effect: [],
        ledger: [],
      }
    case "receipt":
      return null // design: no flow — just a toast
  }
}

// A stable idempotency key for the engine modal (design mints one per runFlow).
const IDEMPOTENCY_KEY = "idem_a8f3c1902e"

// ─── Card primitives (design §5: white/--card, 1px --line, radius 16, pad 18/20) ──

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-line bg-card p-[18px_20px]">
      {children}
    </div>
  )
}

function PanelTitle({
  children,
  note,
}: {
  children: React.ReactNode
  note?: string
}) {
  return (
    <div className="mb-3 text-[13px] font-extrabold text-ink">
      {children}
      {note && <span className="font-semibold text-ink3"> · {note}</span>}
    </div>
  )
}

// ─── Screen ─────────────────────────────────────────────────────────────────────

const LEDGER_GRID = "grid grid-cols-[1.6fr_0.7fr_1fr_0.7fr] gap-2"

// The five flow phases a triage action can move through (the design's runFlow).
type ActivePhase = FlowStep | null

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- route id kept for the later data-wired step
export function TransactionDetail({
  transactionId: _transactionId,
}: TransactionDetailProps) {
  const [copied, setCopied] = useState<string | null>(null)
  // The in-flight action + how far through its step list we are.
  const [activeKind, setActiveKind] = useState<FlowKind | null>(null)
  const [phase, setPhase] = useState<ActivePhase>(null)

  const spec = useMemo(
    () => (activeKind ? flowSpecFor(activeKind) : null),
    [activeKind]
  )

  function copy(value: string) {
    void navigator.clipboard?.writeText(value)
    setCopied(value)
    setTimeout(() => setCopied((c) => (c === value ? null : c)), 1600)
  }

  function startAction(kind: FlowKind) {
    const next = flowSpecFor(kind)
    if (!next) return // receipt: no flow (design fires a toast only)
    setActiveKind(kind)
    setPhase(next.steps[0])
  }

  function closeFlow() {
    setActiveKind(null)
    setPhase(null)
  }

  // Advance to the next step in the active spec, or finish (close) at the end.
  function advance() {
    if (!spec || !phase) return
    const idx = spec.steps.indexOf(phase)
    const nextStep = spec.steps[idx + 1]
    if (nextStep) setPhase(nextStep)
    else closeFlow()
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] overflow-y-auto px-[30px] pt-[22px] pb-[60px]">
      {/* ── Back-link ────────────────────────────────────────────────────────── */}
      <Link
        href="/transactions"
        className="mb-3.5 inline-flex items-center gap-[7px] text-[12.5px] font-bold text-ink2 transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M14 6l-6 6 6 6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        All transactions
      </Link>

      {/* ── Header: title · status pill · copyable id + action buttons ────────── */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0 text-[21px] font-extrabold tracking-[-0.02em] text-ink capitalize">
              {TX.type} · {TX.usdt.toFixed(2)} USDT
            </h1>
            <StatusPill status={TX.status} label="Pending settlement" />
          </div>
          <button
            type="button"
            aria-label="Copy transaction id"
            onClick={() => copy(TX.id)}
            className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[12px] text-ink3 transition-colors hover:text-ink2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {copied === TX.id ? "Copied" : TX.id}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M9 9h10v10H9zM5 15V5h10"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            </svg>
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {TX_ACTIONS.map((a) => (
            <button
              key={a.kind}
              type="button"
              title={a.label}
              onClick={() => startAction(a.kind)}
              className={cn(
                "flex h-9 items-center gap-[7px] rounded-[10px] border px-[13px] text-[12.5px] font-bold transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                a.danger
                  ? "border-[#f0d0cb] bg-card text-tdn hover:bg-sdn"
                  : "border-line bg-card text-ink hover:bg-hov"
              )}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d={a.icon}
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 1.15fr / 1fr grid ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[1.15fr_1fr]">
        {/* Left column */}
        <div className="flex flex-col gap-3.5">
          {/* ── Itemized parameters ─────────────────────────────────────────── */}
          <Panel>
            <PanelTitle note="as confirmed to user">
              Itemized parameters
            </PanelTitle>
            <dl>
              {PARAMS.map((p) => (
                <div
                  key={p.k}
                  className="flex justify-between gap-3 border-b border-line2 py-[9px]"
                >
                  <dt className="text-[12.5px] text-ink2">{p.k}</dt>
                  <dd
                    className={cn(
                      "font-mono text-[12.5px] font-bold tabular-nums",
                      p.warn ? "text-twn" : "text-ink"
                    )}
                  >
                    {p.v}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex items-center gap-[9px] rounded-[10px] bg-card2 px-3 py-2.5">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
                className="text-ink3"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M12 8v5M12 16h.01"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              <span className="text-[11px] text-ink2">
                Rate is spread-folded. Internal margin is operator-only — never
                shown to end users.
              </span>
            </div>
          </Panel>

          {/* ── Double-entry ledger ─────────────────────────────────────────── */}
          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[13px] font-extrabold text-ink">
                Double-entry ledger
              </div>
              <Link
                href="/ledger"
                className="text-[11.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Open ledger →
              </Link>
            </div>
            <div
              className={cn(
                LEDGER_GRID,
                "px-0.5 pb-2 text-[10px] font-bold tracking-[0.04em] text-ink3 uppercase"
              )}
            >
              <div>Account</div>
              <div>Dir</div>
              <div className="text-right">Amount</div>
              <div className="text-right">Seq</div>
            </div>
            {LEDGER.map((l, i) => (
              <div
                key={`${l.acct}-${i}`}
                className={cn(
                  LEDGER_GRID,
                  "items-center border-t border-line2 px-0.5 py-[9px]"
                )}
              >
                <span className="truncate font-mono text-[11.5px] text-ink2">
                  {l.acct}
                </span>
                <span
                  className={cn(
                    "text-[11px] font-extrabold",
                    l.dir === "DEBIT" ? "text-tdn" : "text-tok"
                  )}
                >
                  {l.dir}
                </span>
                <span className="text-right font-mono text-[11.5px] font-bold tabular-nums">
                  {l.amt}
                </span>
                <span className="text-right font-mono text-[11px] text-ink3 tabular-nums">
                  {l.seq}
                </span>
              </div>
            ))}
          </Panel>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-3.5">
          {/* ── Engine state timeline ───────────────────────────────────────── */}
          <Panel>
            <div className="mb-3.5 text-[13px] font-extrabold text-ink">
              Engine state timeline
            </div>
            {TIMELINE.map((s, i) => {
              const tone = TIMELINE_TONE[s.tone]
              return (
                <div key={`${s.label}-${i}`} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "flex size-[22px] flex-none items-center justify-center rounded-full",
                        tone.dotBg,
                        tone.dotFg
                      )}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden
                      >
                        <path
                          d={tone.icon}
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    {s.line && (
                      <span className="min-h-4 w-0.5 flex-1 bg-line2" />
                    )}
                  </div>
                  <div className="flex-1 pb-3.5">
                    <div className={cn("text-[12.5px] font-bold", tone.fg)}>
                      {s.label}
                    </div>
                    <div className="font-mono text-[10.5px] text-ink3 tabular-nums">
                      {s.time}
                    </div>
                  </div>
                </div>
              )
            })}
          </Panel>

          {/* ── Provider references ─────────────────────────────────────────── */}
          <Panel>
            <PanelTitle>Provider references</PanelTitle>
            {REFS.map((r) => (
              <div
                key={r.label}
                className="flex items-center gap-2.5 border-b border-line2 py-[9px] last:border-b-0"
              >
                <span className="flex-none rounded-[6px] bg-card2 px-2 py-0.5 text-[10.5px] font-bold text-ink2">
                  {r.label}
                </span>
                <button
                  type="button"
                  aria-label={`Copy ${r.label} reference`}
                  onClick={() => copy(r.value)}
                  className="flex-1 truncate text-left font-mono text-[11.5px] text-ink2 transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {copied === r.value ? "Copied" : r.value}
                </button>
                {r.link && r.href && (
                  <a
                    href={r.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-none text-[11px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {r.link} ↗
                  </a>
                )}
              </div>
            ))}
          </Panel>

          {/* ── Webhook history ─────────────────────────────────────────────── */}
          <Panel>
            <PanelTitle>Webhook history</PanelTitle>
            {WEBHOOKS.map((w) => (
              <div
                key={w.event}
                className="flex items-center gap-2.5 border-b border-line2 py-2 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-[7px] flex-none rounded-full",
                    w.tone === "ok" ? "bg-[#1f8a5b]" : "bg-[#e0a53a]"
                  )}
                />
                <span className="flex-1 truncate font-mono text-[11.5px] font-semibold text-ink">
                  {w.event}
                </span>
                <span className="text-[11px] text-ink3 tabular-nums">
                  {w.time}
                </span>
              </div>
            ))}
          </Panel>
        </div>
      </div>

      {/* ── Flow modals (design runFlow: reason → step-up → engine [→ maker]) ──── */}
      {spec && (
        <>
          <ReasonModal
            open={phase === "reason"}
            onOpenChange={(o) => !o && closeFlow()}
            title={spec.title}
            onContinue={advance}
          />
          <StepUpModal
            open={phase === "stepup"}
            onOpenChange={(o) => !o && closeFlow()}
            title={spec.title}
            onComplete={advance}
          />
          <EngineActionModal
            open={phase === "engine"}
            onOpenChange={(o) => !o && closeFlow()}
            title={spec.title}
            effect={spec.effect}
            ledger={spec.ledger}
            idempotencyKey={IDEMPOTENCY_KEY}
            cta={spec.cta}
            onExecute={advance}
          />
          <MakerCheckerModal
            open={phase === "maker"}
            onOpenChange={(o) => !o && closeFlow()}
            title={spec.title}
            diff={spec.diff ?? []}
            onSubmit={advance}
          />
        </>
      )}
    </div>
  )
}
