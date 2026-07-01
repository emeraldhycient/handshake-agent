"use client"

/**
 * AdminsPage — the "Admins & roles" surface, reproduced pixel-for-pixel from the
 * Operator Console design (`docs/design-ref/screens/Admins.html`, spec §6.15).
 *
 * DESIGN REPRODUCTION ONLY. This screen renders the design's OWN mock content so
 * it looks EXACTLY like the design; it does NOT fetch real data (no TanStack
 * Query). Real-data reintegration is a separate later step. The admin rows +
 * role-dot colours are translated verbatim from `logic.js` (seed `admins`, lines
 * 132-137; `roleMeta()`, lines 168-173). The role permission matrix is
 * design-faithful sample content built from `roleMeta()` + the `can()` grants
 * (lines 177-183), matching the markup's 6 role columns × 7 capability rows.
 *
 * Layout (design lines 2-16): header (title + subtitle + dark "+ Invite admin"
 * CTA) → the admin table (Admin · Role · 2FA · Status · row actions) → the Role
 * permission matrix card (roles × capabilities, access-level icon tiles + legend).
 *
 * Actions wire to the same destinations as the design: "Reset 2FA" → step-up;
 * "Deactivate/Reactivate" → reason → maker-checker; "+ Invite admin" → the invite
 * dialog. Design-faithful presentation only — no funds/DB side effects here.
 */
import { useState } from "react"
import type { Role } from "@handshake-agent/contracts"

import { cn } from "@/lib/utils"
import { InviteAdminDialog } from "@/components/admin/invite-admin-dialog"
import {
  MakerCheckerModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"

// ─── Brand + status constants (mapped to design tokens; §1.3 / stMeta) ─────────

/** Admin/operator striped avatar (§1.3) — brand-green diagonal stripes. */
const AVATAR_STRIPE =
  "repeating-linear-gradient(45deg,#2a6f55 0 5px,#1a4536 5px 10px)"

/** Role-dot colours from `roleMeta()` (logic.js 168-173), mapped to design tokens. */
const ROLE_DOT: Record<string, string> = {
  super_admin: "var(--brand-amber)",
  compliance_officer: "var(--tif)",
  treasury_ops: "var(--tok)",
  support_agent: "#8a4b8a",
  config_admin: "#c07a2a",
  read_only_analyst: "var(--ink3)",
}

/** Role display labels from `roleMeta()` (logic.js 168-173). */
const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  compliance_officer: "Compliance Officer",
  treasury_ops: "Treasury Ops",
  support_agent: "Support Agent",
  config_admin: "Config Admin",
  read_only_analyst: "Read-only Analyst",
}

/** Shared grid template for the admin table header + every body row (design 5/6). */
const ADMIN_GRID = "grid-cols-[1.6fr_1.3fr_0.8fr_0.9fr_1.2fr] gap-3 px-[18px]"

// ─── Mock data (design seed `admins`, logic.js 132-137) ────────────────────────

interface AdminSeed {
  id: string
  name: string
  email: string
  role: keyof typeof ROLE_LABEL
  tfa: boolean
  active: boolean
}

/**
 * design-faithful role list for the Invite-admin dialog's role select — the six
 * built-in roles from `roleMeta()` (logic.js 168-173). Static content only (no
 * fetch); ids are stable placeholders so the select renders the same choices the
 * design shows.
 */
const INVITE_ROLES: Role[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Super Admin",
    description: "Full access to every surface",
    isBuiltin: true,
    permissionIds: [],
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Compliance Officer",
    description: "KYC, sanctions, AML, cases",
    isBuiltin: true,
    permissionIds: [],
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    name: "Treasury Ops",
    description: "Money, ledger, treasury, recon",
    isBuiltin: true,
    permissionIds: [],
  },
  {
    id: "00000000-0000-0000-0000-000000000004",
    name: "Support Agent",
    description: "Users & transactions (read-mostly)",
    isBuiltin: true,
    permissionIds: [],
  },
  {
    id: "00000000-0000-0000-0000-000000000005",
    name: "Config Admin",
    description: "Settings, pricing, capabilities",
    isBuiltin: true,
    permissionIds: [],
  },
  {
    id: "00000000-0000-0000-0000-000000000006",
    name: "Read-only Analyst",
    description: "View everything, change nothing",
    isBuiltin: true,
    permissionIds: [],
  },
]

const ADMINS: readonly AdminSeed[] = [
  {
    id: "ad1",
    name: "Amara Okeke",
    email: "amara@handshake.ng",
    role: "super_admin",
    tfa: true,
    active: true,
  },
  {
    id: "ad2",
    name: "Ifeoma Bello",
    email: "ifeoma@handshake.ng",
    role: "compliance_officer",
    tfa: true,
    active: true,
  },
  {
    id: "ad3",
    name: "Kelechi Chukwu",
    email: "kelechi@handshake.ng",
    role: "treasury_ops",
    tfa: true,
    active: true,
  },
  {
    id: "ad4",
    name: "Tunde Adeyemi",
    email: "tunde@handshake.ng",
    role: "config_admin",
    tfa: true,
    active: true,
  },
  {
    id: "ad5",
    name: "Segun Ojo",
    email: "segun@handshake.ng",
    role: "support_agent",
    tfa: false,
    active: true,
  },
  {
    id: "ad6",
    name: "Grace Effiong",
    email: "grace@handshake.ng",
    role: "read_only_analyst",
    tfa: true,
    active: false,
  },
]

// ─── Role permission matrix (design lines 9-14) ────────────────────────────────

/**
 * Access level per matrix cell → its icon tile (design line 12/14): full-access
 * (check, `--sok`/`--tok`), read-only (eye, `--sif`/`--tif`), no-access (cross,
 * `--card2`/`--ink3`). The label beside each column + the title tooltip carry the
 * meaning, so colour is never the sole signal.
 */
type Access = "full" | "read" | "none"

const ACCESS_META: Record<
  Access,
  { icon: string; bg: string; fg: string; title: string; strokeWidth: number }
> = {
  full: {
    icon: "m5 12 5 5L20 7",
    bg: "var(--sok,#e6f3ec)",
    fg: "var(--tok,#1f8a5b)",
    title: "Full access",
    strokeWidth: 2.4,
  },
  read: {
    icon: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z",
    bg: "var(--sif,#e9f0fd)",
    fg: "var(--tif,#3168e6)",
    title: "Read-only",
    strokeWidth: 2,
  },
  none: {
    icon: "M6 6l12 12M18 6L6 18",
    bg: "var(--card2,#faf8f2)",
    fg: "var(--ink3,#8b948a)",
    title: "No access",
    strokeWidth: 2.4,
  },
}

/** The 6 role columns (short labels), in `roleMeta()` order (logic.js 168-173). */
const MATRIX_COLS: readonly string[] = [
  "Super Admin",
  "Compliance",
  "Treasury",
  "Support",
  "Config",
  "Read-only",
]

/**
 * The capability rows × their access level per role column, derived from the
 * design's `can()` grants (logic.js 177-183). Super Admin is full everywhere;
 * Read-only Analyst is read everywhere; each other role has full where granted,
 * read on view-only surfaces, none otherwise. Design-faithful sample content.
 */
interface MatrixRow {
  label: string
  cells: readonly Access[]
}

const MATRIX_ROWS: readonly MatrixRow[] = [
  {
    label: "Users & accounts",
    cells: ["full", "read", "read", "read", "none", "read"],
  },
  {
    label: "KYC & compliance",
    cells: ["full", "full", "none", "none", "none", "read"],
  },
  {
    label: "Transactions & ledger",
    cells: ["full", "read", "full", "read", "none", "read"],
  },
  {
    label: "Treasury & recon",
    cells: ["full", "none", "full", "none", "none", "read"],
  },
  {
    label: "Configuration",
    cells: ["full", "none", "none", "none", "full", "read"],
  },
  {
    label: "Approvals",
    cells: ["full", "full", "full", "none", "full", "none"],
  },
  {
    label: "Admins & roles",
    cells: ["full", "none", "none", "none", "none", "read"],
  },
]

// ─── Page ──────────────────────────────────────────────────────────────────────

/** The four flow steps a row action can currently be waiting on. */
type ActiveFlow = "reason" | "maker" | "stepUp" | null

export function AdminsPage() {
  const [inviteOpen, setInviteOpen] = useState(false)

  // The row-action flow. "Deactivate/Reactivate" runs reason → maker-checker;
  // "Reset 2FA" runs step-up directly. Presentation only (no side effects).
  const [flow, setFlow] = useState<ActiveFlow>(null)
  const [flowAdmin, setFlowAdmin] = useState<AdminSeed | null>(null)

  function closeFlow() {
    setFlow(null)
    setFlowAdmin(null)
  }

  const flowActionLabel =
    flowAdmin && (flowAdmin.active ? "Deactivate admin" : "Reactivate admin")

  return (
    <div className="mx-auto w-full max-w-[1300px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Admins &amp; roles
          </h1>
          <p className="mt-[5px] text-[13.5px] text-ink2">
            Admin users, the role permission matrix, and session policy.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="flex h-[38px] items-center gap-[7px] rounded-[11px] bg-btn-dark px-[15px] text-[12.5px] font-bold text-white transition-colors hover:bg-btn-dark/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          + Invite admin
        </button>
      </div>

      {/* ── Admin table ────────────────────────────────────────────────────── */}
      <div className="mb-4 overflow-hidden rounded-[16px] border border-line bg-card">
        {/* Header row */}
        <div
          className={cn(
            "grid border-b border-line bg-card2 py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase",
            ADMIN_GRID
          )}
        >
          <div>Admin</div>
          <div>Role</div>
          <div>2FA</div>
          <div>Status</div>
          <div aria-hidden="true" />
        </div>

        {ADMINS.map((admin) => (
          <AdminRow
            key={admin.id}
            admin={admin}
            onReset2fa={() => {
              setFlowAdmin(admin)
              setFlow("stepUp")
            }}
            onToggleActive={() => {
              setFlowAdmin(admin)
              setFlow("reason")
            }}
          />
        ))}
      </div>

      {/* ── Role permission matrix ─────────────────────────────────────────── */}
      <div className="scr overflow-x-auto rounded-[16px] border border-line bg-card px-[20px] py-[18px]">
        <div className="mb-[14px] text-[13px] font-extrabold text-ink">
          Role permission matrix
        </div>
        <div className="min-w-[640px]">
          {/* Column header */}
          <div className="grid grid-cols-[1.4fr_repeat(6,1fr)] gap-2 border-b border-line pb-[10px]">
            <div />
            {MATRIX_COLS.map((c) => (
              <div
                key={c}
                className="text-center text-[10px] leading-[1.2] font-bold text-ink3"
              >
                {c}
              </div>
            ))}
          </div>

          {/* Capability rows */}
          {MATRIX_ROWS.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[1.4fr_repeat(6,1fr)] items-center gap-2 border-b border-line2 py-[11px] last:border-b-0"
            >
              <div className="text-[12.5px] font-bold text-ink">
                {row.label}
              </div>
              {row.cells.map((access, i) => {
                const meta = ACCESS_META[access]
                return (
                  <div
                    key={`${row.label}-${MATRIX_COLS[i]}`}
                    className="flex justify-center"
                  >
                    <span
                      title={`${MATRIX_COLS[i]} · ${meta.title}`}
                      className="flex size-6 items-center justify-center rounded-[7px]"
                      style={{ background: meta.bg, color: meta.fg }}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d={meta.icon}
                          stroke="currentColor"
                          strokeWidth={meta.strokeWidth}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-[14px] flex flex-wrap gap-4">
          <LegendItem
            bg="var(--sok,#e6f3ec)"
            fg="var(--tok,#1f8a5b)"
            icon="m5 12 5 5L20 7"
            strokeWidth={2.4}
            label="Full access"
          />
          <LegendItem
            bg="var(--sif,#e9f0fd)"
            fg="var(--tif,#3168e6)"
            icon="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
            strokeWidth={2}
            label="Read-only"
          />
          <LegendItem
            bg="var(--card2,#faf8f2)"
            fg="var(--ink3,#8b948a)"
            icon="M6 6l12 12M18 6L6 18"
            strokeWidth={2.4}
            label="No access"
          />
        </div>
      </div>

      {/* ── Flow modals (Reset 2FA · Deactivate/Reactivate · Invite) ───────── */}
      <ReasonModal
        open={flow === "reason"}
        onOpenChange={(open) => {
          if (!open) closeFlow()
        }}
        title={flowActionLabel ?? "Change admin status"}
        onContinue={() => setFlow("maker")}
      />
      <MakerCheckerModal
        open={flow === "maker"}
        onOpenChange={(open) => {
          if (!open) closeFlow()
        }}
        title={flowActionLabel ?? "Change admin status"}
        diff={
          flowAdmin
            ? [
                {
                  field: `Admin: ${flowAdmin.name}`,
                  from: flowAdmin.active ? "Active" : "Deactivated",
                  to: flowAdmin.active ? "Deactivated" : "Active",
                },
              ]
            : []
        }
        onSubmit={closeFlow}
      />
      <StepUpModal
        open={flow === "stepUp"}
        onOpenChange={(open) => {
          if (!open) closeFlow()
        }}
        title={flowAdmin ? `Reset 2FA for ${flowAdmin.name}` : "Reset 2FA"}
        onComplete={closeFlow}
      />

      <InviteAdminDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={INVITE_ROLES}
      />
    </div>
  )
}

/** One admin table row (design line 6). */
function AdminRow({
  admin,
  onReset2fa,
  onToggleActive,
}: {
  admin: AdminSeed
  onReset2fa: () => void
  onToggleActive: () => void
}) {
  const actionLabel = admin.active ? "Deactivate" : "Reactivate"
  return (
    <div
      className={cn(
        "grid items-center border-b border-line2 py-[13px] last:border-b-0",
        ADMIN_GRID
      )}
    >
      {/* Admin — striped avatar + name + email */}
      <div className="flex min-w-0 items-center gap-[11px]">
        <span
          aria-hidden="true"
          className="size-8 flex-none rounded-full"
          style={{ background: AVATAR_STRIPE }}
        />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-ink">
            {admin.name}
          </div>
          <div className="truncate text-[11px] text-ink3">{admin.email}</div>
        </div>
      </div>

      {/* Role — dot + label */}
      <div>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-ink">
          <span
            aria-hidden="true"
            className="size-2 flex-none rounded-full"
            style={{ background: ROLE_DOT[admin.role] }}
          />
          {ROLE_LABEL[admin.role]}
        </span>
      </div>

      {/* 2FA — enrolment state (label carries the meaning, not just colour) */}
      <div>
        {admin.tfa ? (
          <span className="text-[11px] font-bold text-tok">Enrolled</span>
        ) : (
          <span className="text-[11px] font-bold text-ink3">Not set</span>
        )}
      </div>

      {/* Status pill */}
      <div>
        {admin.active ? (
          <span className="rounded-full bg-sok px-[9px] py-[2px] text-[10.5px] font-bold text-tok">
            Active
          </span>
        ) : (
          <span className="rounded-full bg-card2 px-[9px] py-[2px] text-[10.5px] font-bold text-ink2">
            Deactivated
          </span>
        )}
      </div>

      {/* Row actions */}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onReset2fa}
          className="text-[11.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Reset 2FA
        </button>
        <button
          type="button"
          onClick={onToggleActive}
          className="text-[11.5px] font-bold text-ink3 transition-colors hover:text-ink2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  )
}

/** One legend swatch under the matrix (design line 14). */
function LegendItem({
  bg,
  fg,
  icon,
  strokeWidth,
  label,
}: {
  bg: string
  fg: string
  icon: string
  strokeWidth: number
  label: string
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-ink2">
      <span
        className="flex size-4 items-center justify-center rounded-[5px]"
        style={{ background: bg, color: fg }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d={icon}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {label}
    </div>
  )
}
