"use client"

/**
 * AuditPage — the immutable, hash-chained audit-log viewer, reproduced
 * pixel-for-pixel from the operator-console design
 * (`docs/design-ref/screens/Audit.html`, spec §6.10).
 *
 * DESIGN REPRODUCTION ONLY. This screen intentionally renders the design's own
 * mock dataset (translated from `logic.js` `seed()` `audit=[…]` + `vAudit()` +
 * the `actColor` helper) and does NOT fetch real data — no TanStack Query. Real
 * data reintegration is a separate later step.
 *
 * Layout (design markup, `Audit.html`):
 *   - Header: "Audit log" title + subtitle; a right cluster with a static
 *     "Hash-chain verified" pill and an Export action.
 *   - A single rounded search field ("actor, target, action…") that filters the
 *     mock rows client-side across actor/target/action/reason (vAudit's `q`).
 *   - One card holding the table: Actor (name + role) · Action (mono chip) ·
 *     Target (mono) · Before → after (strike-red → green) · Reason · Time.
 *   - The design paginates at size 6 (`mkPager('audit', …, 6, '1300px')`); the
 *     shared Pagination is composed and behaves identically.
 */
import { useMemo, useState } from "react"

import { Pagination } from "@/components/admin/pagination"

// One row of the design's seed `audit` dataset (logic.js `seed()`, lines 82-89).
type AuditRow = {
  id: string
  actor: string
  role: string
  action: string
  target: string
  before: string
  after: string
  reason: string
  ip: string
  time: string
}

// The design's `roleMeta()` label map (logic.js line 167). `engine` is not in the
// map, so the design falls back to the raw role key ("engine") — reproduced here.
const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  compliance_officer: "Compliance Officer",
  treasury_ops: "Treasury Ops",
  support_agent: "Support Agent",
  config_admin: "Config Admin",
  read_only_analyst: "Read-only Analyst",
}

// The design's seed `audit` dataset — verbatim (logic.js `seed()`, lines 82-89).
const AUDIT: readonly AuditRow[] = [
  {
    id: "a1",
    actor: "Amara Okeke",
    role: "super_admin",
    action: "config.update",
    target: "AppSetting: reconciliation.cron.enabled",
    before: "false",
    after: "true",
    reason: "Enable nightly reconciliation",
    ip: "102.89.34.11",
    time: "Jul 1 · 08:42:10",
  },
  {
    id: "a2",
    actor: "Ifeoma Bello",
    role: "compliance_officer",
    action: "kyc.approve",
    target: "usr_10501 (Emeka Okonkwo)",
    before: "pending",
    after: "verified · tier_1",
    reason: "Documents match, name-enquiry OK",
    ip: "41.203.9.88",
    time: "Jul 1 · 08:20:55",
  },
  {
    id: "a3",
    actor: "Kelechi Chukwu",
    role: "treasury_ops",
    action: "settlement.retry",
    target: "tx_80244",
    before: "pending_settlement",
    after: "settled",
    reason: "Provider webhook replay",
    ip: "102.89.34.51",
    time: "Jun 30 · 23:11:02",
  },
  {
    id: "a4",
    actor: "Tunde Adeyemi",
    role: "config_admin",
    action: "pii.reveal",
    target: "usr_10508 · NIN",
    before: "masked",
    after: "viewed",
    reason: "Manual KYC discrepancy review",
    ip: "197.210.7.3",
    time: "Jun 30 · 19:44:20",
  },
  {
    id: "a5",
    actor: "System",
    role: "engine",
    action: "ledger.write",
    target: "tx_80231 (settled)",
    before: "—",
    after: "DR/CR posted · seq 44921",
    reason: "Webhook settlement",
    ip: "—",
    time: "Jun 30 · 18:02:41",
  },
  {
    id: "a6",
    actor: "Amara Okeke",
    role: "super_admin",
    action: "user.freeze",
    target: "usr_10494 (Bola Balogun)",
    before: "active",
    after: "frozen",
    reason: "SIM-swap flag + velocity breach",
    ip: "102.89.34.11",
    time: "Jun 30 · 15:30:18",
  },
] as const

// Page size for the audit table (design: `mkPager('audit', …, 6, '1300px')`).
const PAGE_SIZE = 6

// Grid column template shared by the header row and every body row so the two
// stay aligned. Matches the design's `1.1fr 1fr 1.4fr 1.6fr 1.2fr 0.9fr`.
const GRID_COLS = "grid-cols-[1.1fr_1fr_1.4fr_1.6fr_1.2fr_0.9fr]"

/**
 * The design's `actColor(action)` helper (logic.js line 783): maps an action to
 * its mono-chip `[background, foreground]` token pair by keyword. Reproduced 1:1
 * as Tailwind token classes (var(--sdn)/var(--tdn) → bg-sdn/text-tdn, etc).
 */
function actionChip(action: string): string {
  if (/reject|freeze|fail|block/.test(action)) return "bg-sdn text-tdn"
  if (/pii/.test(action)) return "bg-sdn text-tdn"
  if (/config|update|pricing/.test(action)) return "bg-swn text-twn"
  if (/ledger|settle|credit|approve/.test(action)) return "bg-sok text-tok"
  return "bg-sif text-tif"
}

export function AuditPage() {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)

  // vAudit's client filter: match the query against actor+target+action+reason.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return AUDIT
    return AUDIT.filter((a) =>
      (a.actor + a.target + a.action + a.reason).toLowerCase().includes(q)
    )
  }, [search])

  // The design resets to page 1 on every search input (onAuditSearch: pg_audit:1).
  const onSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const pageRows = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  )

  return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-1 flex-col overflow-y-auto px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header: title + subtitle · hash-chain pill + Export ─────────────── */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Audit log
          </h1>
          <p className="mt-[5px] text-[13.5px] text-ink2">
            Immutable record of every mutating action. Never editable, nothing
            hard-deleted.
          </p>
        </div>
        <div className="flex items-center gap-[9px]">
          <span className="flex h-[34px] items-center gap-[7px] rounded-full bg-sok px-3 text-[11.5px] font-bold text-tok">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path
                d="m9 12 2 2 4-4"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Hash-chain verified
          </span>
          <button
            type="button"
            className="flex h-[34px] cursor-pointer items-center gap-[7px] rounded-[10px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Export
          </button>
        </div>
      </div>

      {/* ── Search ──────────────────────────────────────────────────────────── */}
      <div className="mb-[14px] flex flex-wrap gap-[10px]">
        <div className="flex h-[38px] min-w-[230px] items-center gap-2 rounded-[11px] border border-line bg-card px-3">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="text-ink3"
          >
            <circle
              cx="11"
              cy="11"
              r="7"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="m20 20-3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="actor, target, action…"
            aria-label="Search audit log by actor, target, or action"
            className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink3"
          />
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[16px] border border-line bg-card">
        {/* Header row */}
        <div
          className={`grid ${GRID_COLS} gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase`}
        >
          <div>Actor</div>
          <div>Action</div>
          <div>Target</div>
          <div>Before → after</div>
          <div>Reason</div>
          <div>Time</div>
        </div>
        {/* Body rows */}
        {pageRows.map((a) => (
          <div
            key={a.id}
            className={`grid ${GRID_COLS} items-center gap-3 border-b border-line2 px-[18px] py-3 last:border-b-0`}
          >
            {/* Actor + role */}
            <div className="min-w-0">
              <div className="text-[12.5px] font-bold text-ink">{a.actor}</div>
              <div className="text-[10.5px] text-ink3">
                {ROLE_LABEL[a.role] ?? a.role}
              </div>
            </div>
            {/* Action chip */}
            <div>
              <span
                className={`inline-flex rounded-[6px] px-2 py-0.5 font-mono text-[11px] font-bold ${actionChip(a.action)}`}
              >
                {a.action}
              </span>
            </div>
            {/* Target */}
            <div
              className="truncate font-mono text-[11.5px] text-ink2"
              title={a.target}
            >
              {a.target}
            </div>
            {/* Before → after */}
            <div className="text-[11.5px]">
              <span className="font-mono text-tdn line-through opacity-75">
                {a.before}
              </span>{" "}
              <span className="font-mono font-bold text-tok">→ {a.after}</span>
            </div>
            {/* Reason */}
            <div className="text-[11.5px] text-ink2">{a.reason}</div>
            {/* Time */}
            <div className="font-mono text-[11px] text-ink3 tabular-nums">
              {a.time}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination (design: mkPager size 6, maxWidth 1300px). */}
      <Pagination
        total={filtered.length}
        pageSize={PAGE_SIZE}
        page={page}
        onPageChange={setPage}
        maxWidth="1300px"
      />
    </div>
  )
}
