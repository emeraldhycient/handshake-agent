"use client"

/**
 * AmlPage — the AML / risk screen, reproduced pixel-for-pixel from
 * `docs/design-ref/screens/Aml.html` (SPEC §6.6). A `1.2fr 1fr` grid:
 *
 *   - LEFT  · Risk rules — the admin-tunable engine thresholds, one row each with a
 *     name, description, a mono/tnum threshold, and an edit pencil. The card title
 *     carries the "· thresholds are maker-checker" suffix — editing a threshold is a
 *     dual-control change (never moves money; thresholds only annotate the engine's
 *     rule set, root §3.1). The pencil opens the shared MakerCheckerModal.
 *   - RIGHT top · Open cases — the still-open flagged compliance cases, each a
 *     severity dot + title + meta + status pill, with a "Draft SAR/CTR" link that
 *     opens the shared ReasonModal (the draft is recorded in the immutable audit log).
 *   - RIGHT bottom · Travel Rule records — a read-only summary of qualifying
 *     transfers captured over the $1,000 threshold in the last 24h.
 *
 * DESIGN REPRODUCTION (not data-wired): `docs/design-ref/logic.js` does not contain
 * the `vAml()` view method (truncated), so the content below is the design's own
 * representative sample — module-level constants that mirror the markup + SPEC §6.6 +
 * the `seed()` dataset shapes (operator names like "Amara Okeke", case metas, the
 * status→token pairs from `stMeta`). No fetching; real-data reintegration is a
 * separate later step.
 *
 * The `{{ c.dot }}` / `{{ c.stBg }}` / `{{ c.stFg }}` inline styles from the markup map
 * onto the design's semantic status tokens (§5 status→token map): the leading dot's
 * surface + the status pill's `s*`/`t*` pair. Colour is never the sole signal — every
 * pill carries its label.
 */
import { useState } from "react"

import { cn } from "@/lib/utils"
import { ReasonModal, MakerCheckerModal } from "@/components/admin/flows"

// ── Risk rules (LEFT) — representative sample (SPEC §6.6 + seed() shapes) ────────────

interface RiskRule {
  id: string
  /** The rule name (design `r.name`). */
  name: string
  /** The one-line description (design `r.desc`, --ink3). */
  desc: string
  /** The maker-checker threshold (design `r.threshold`, mono/tnum). */
  threshold: string
}

const RISK_RULES: readonly RiskRule[] = [
  {
    id: "rule_velocity_24h",
    name: "High velocity — 24h",
    desc: "Flag when a user exceeds transfers/day",
    threshold: "≥ 12 / 24h",
  },
  {
    id: "rule_large_single",
    name: "Large single transfer",
    desc: "Case opens above per-transfer amount",
    threshold: "$10,000",
  },
  {
    id: "rule_structuring",
    name: "Structuring pattern",
    desc: "Multiple sub-threshold sends within window",
    threshold: "3 × $900 / 1h",
  },
  {
    id: "rule_new_beneficiary",
    name: "New beneficiary, high value",
    desc: "First payout to a beneficiary above amount",
    threshold: "$5,000",
  },
]

// ── Open cases (RIGHT top) — representative sample; the `{{ c.* }}` inline styles map
// onto the semantic status tokens (§5 status→token map).

type CaseStatus = "flagged" | "under_review" | "escalated"

interface OpenCase {
  id: string
  /** The case title (design `c.title`). */
  title: string
  /** The case meta line (design `c.meta`, --ink3). */
  meta: string
  status: CaseStatus
}

// Status → { dot surface, pill label, pill surface + text }. Flagged reads danger,
// under-review reads warning, escalated reads info — mirroring the design's `stMeta`.
const CASE_STATUS_META: Record<
  CaseStatus,
  { dot: string; label: string; pillBg: string; pillFg: string }
> = {
  flagged: {
    dot: "bg-tdn",
    label: "Flagged",
    pillBg: "bg-sdn",
    pillFg: "text-tdn",
  },
  under_review: {
    dot: "bg-twn",
    label: "In review",
    pillBg: "bg-swn",
    pillFg: "text-twn",
  },
  escalated: {
    dot: "bg-tif",
    label: "Escalated",
    pillBg: "bg-sif",
    pillFg: "text-tif",
  },
}

const OPEN_CASES: readonly OpenCase[] = [
  {
    id: "case_4471",
    title: "Structuring — Amara Okeke",
    meta: "3 sends · $2,700 total · 52m",
    status: "flagged",
  },
  {
    id: "case_4468",
    title: "High velocity — Chidi Eze",
    meta: "14 transfers in 24h · 3h ago",
    status: "under_review",
  },
  {
    id: "case_4462",
    title: "Large transfer — Ngozi Balogun",
    meta: "$11,400 send · beneficiary 2d old · 6h ago",
    status: "escalated",
  },
]

// ── Small icons ─────────────────────────────────────────────────────────────────────

/** The edit pencil on a risk-rule row (design line 7). */
function EditPencilIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 20h4l10-10-4-4L4 16z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Cards ─────────────────────────────────────────────────────────────────────────

/** A card shell — the design's white rounded-16 panel (padding 18px 20px). */
function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-line bg-card px-5 py-[18px]">
      {children}
    </div>
  )
}

/** Risk-rules card (design lines 5–8). */
function RiskRulesCard({ onEdit }: { onEdit: (rule: RiskRule) => void }) {
  return (
    <CardShell>
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Risk rules{" "}
        <span className="font-semibold text-ink3">
          · thresholds are maker-checker
        </span>
      </div>
      <div>
        {RISK_RULES.map((rule) => (
          <div
            key={rule.id}
            className="flex items-center gap-3 border-b border-line2 py-[11px] last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-bold text-ink">
                {rule.name}
              </div>
              <div className="truncate text-[11px] text-ink3">{rule.desc}</div>
            </div>
            <span className="font-mono text-[12.5px] font-bold text-ink tabular-nums">
              {rule.threshold}
            </span>
            <button
              type="button"
              onClick={() => onEdit(rule)}
              aria-label={`Edit rule ${rule.name}`}
              className="flex size-7 flex-none items-center justify-center rounded-lg border border-line text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <EditPencilIcon />
            </button>
          </div>
        ))}
      </div>
    </CardShell>
  )
}

/** Open-cases card (design lines 10–13). */
function OpenCasesCard({ onDraftSar }: { onDraftSar: () => void }) {
  return (
    <CardShell>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-extrabold text-ink">Open cases</div>
        <button
          type="button"
          onClick={onDraftSar}
          className="cursor-pointer text-[11.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Draft SAR/CTR
        </button>
      </div>
      <div>
        {OPEN_CASES.map((c) => {
          const meta = CASE_STATUS_META[c.status]
          return (
            <div
              key={c.id}
              className="flex items-center gap-[11px] border-b border-line2 py-2.5 last:border-b-0"
            >
              <span
                aria-hidden="true"
                className={cn("size-2 flex-none rounded-full", meta.dot)}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold text-ink">
                  {c.title}
                </div>
                <div className="truncate text-[10.5px] text-ink3">{c.meta}</div>
              </div>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10.5px] font-bold",
                  meta.pillBg,
                  meta.pillFg
                )}
              >
                {meta.label}
              </span>
            </div>
          )
        })}
      </div>
    </CardShell>
  )
}

/** Travel-Rule records card (design lines 14–17). */
function TravelRuleCard() {
  return (
    <CardShell>
      <div className="mb-2.5 text-[13px] font-extrabold text-ink">
        Travel Rule records
      </div>
      <p className="text-[12px] leading-normal text-ink2">
        Originator/beneficiary records attached for{" "}
        <b className="font-bold">3</b> qualifying transfers over the{" "}
        <span className="font-mono">$1,000</span> threshold in the last 24h.
      </p>
    </CardShell>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────────

// The active flow: editing a risk-rule threshold (maker-checker) or drafting a SAR/CTR
// (reason). Mirrors how the design's `runFlow` chains each affordance to a flow modal.
type ActiveFlow =
  | { kind: "editRule"; rule: RiskRule }
  | { kind: "draftSar" }
  | null

export function AmlPage() {
  const [flow, setFlow] = useState<ActiveFlow>(null)

  return (
    <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header (design line 3) ─────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          AML / risk
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Rules, case management, SAR/CTR drafting and Travel Rule records.
        </p>
      </div>

      {/* ── 1.2fr / 1fr grid (design line 4) ───────────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-[14px] lg:grid-cols-[1.2fr_1fr]">
        <RiskRulesCard onEdit={(rule) => setFlow({ kind: "editRule", rule })} />
        <div className="flex flex-col gap-[14px]">
          <OpenCasesCard onDraftSar={() => setFlow({ kind: "draftSar" })} />
          <TravelRuleCard />
        </div>
      </div>

      {/* ── Flow modals (shared funds-safety flows, SPEC §5) ───────────────── */}

      {/* Edit threshold → MakerCheckerModal (dual-control; enters Pending approval). */}
      <MakerCheckerModal
        open={flow?.kind === "editRule"}
        onOpenChange={(next) => !next && setFlow(null)}
        title={
          flow?.kind === "editRule"
            ? `Edit threshold — ${flow.rule.name}`
            : "Edit risk-rule threshold"
        }
        diff={
          flow?.kind === "editRule"
            ? [
                {
                  field: flow.rule.name,
                  from: flow.rule.threshold,
                  to: flow.rule.threshold,
                },
              ]
            : []
        }
        onSubmit={() => setFlow(null)}
      />

      {/* Draft SAR/CTR → ReasonModal (recorded in the immutable audit log). */}
      <ReasonModal
        open={flow?.kind === "draftSar"}
        onOpenChange={(next) => !next && setFlow(null)}
        title="Draft SAR/CTR"
        onContinue={() => setFlow(null)}
      />
    </div>
  )
}
