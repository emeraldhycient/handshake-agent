"use client"

/**
 * AdminsPage — the admin-user management surface. Lists admins (identity / role /
 * 2FA / status), offers an "Invite admin" dialog, and per-row sensitive actions
 * (change role, suspend/reactivate/offboard) gated by step-up.
 *
 * Four async branches on the admins query: loading / error / empty / data.
 */
import { useState } from "react"
import { ShieldUser } from "lucide-react"
import type { AdminUser, Role } from "@handshake-agent/contracts"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/admin/status-badge"
import { AdminRowActions } from "@/components/admin/admin-row-actions"
import { InviteAdminDialog } from "@/components/admin/invite-admin-dialog"
import { useAdmins, useRoles } from "@/lib/query/hooks"

// Role-dot colours (design §1.3), mapped to design tokens. Keyed by the
// canonical built-in role names; support/custom/free-text roles fall back to the
// neutral tertiary ink. The dot is decorative — the role label beside it carries
// the meaning, so colour is never the sole signal.
const ROLE_DOT: Record<string, string> = {
  super_admin: "var(--brand-amber)",
  compliance_officer: "var(--tif)",
  treasury_ops: "var(--tok)",
  config_admin: "var(--twn)",
  read_only_analyst: "var(--ink3)",
}

function roleDotColor(roleName: string): string {
  const key = roleName
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
  return ROLE_DOT[key] ?? "var(--ink3)"
}

/** Display name derived from the email local-part (identity is the email). */
function displayName(email: string): string {
  return email.split("@")[0]
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never"
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function AdminsPage() {
  const admins = useAdmins()
  const roles = useRoles()
  const [inviteOpen, setInviteOpen] = useState(false)

  return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-1 flex-col gap-4 overflow-y-auto px-[30px] py-[26px]">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Admins &amp; roles
          </h1>
          <p className="mt-1 text-[13.5px] text-ink2">
            Admin users, their roles, and 2FA enrolment.
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => setInviteOpen(true)}
          disabled={!roles.data}
        >
          + Invite admin
        </Button>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {admins.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-[52px] w-full rounded-[11px]" />
          <Skeleton className="h-[52px] w-full rounded-[11px]" />
          <Skeleton className="h-[52px] w-full rounded-[11px]" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {admins.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn/40 p-5 text-center">
          <p className="text-sm font-bold text-tdn">Failed to load admins</p>
          <p className="mt-1 text-xs text-ink3">Please refresh the page.</p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {admins.isSuccess && admins.data.items.length === 0 && (
        <div className="rounded-[16px] border border-line bg-card px-5 py-[60px] text-center">
          <span className="mx-auto flex size-11 items-center justify-center rounded-[12px] bg-card2 text-ink3">
            <ShieldUser aria-hidden="true" className="size-5" />
          </span>
          <p className="mt-3 text-[14px] font-bold text-ink2">No admins yet</p>
          <p className="mt-1 text-[12.5px] text-ink3">
            Invite your first admin to get started.
          </p>
        </div>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {admins.isSuccess && admins.data.items.length > 0 && (
        <div className="overflow-hidden rounded-[16px] border border-line bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Admin</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>2FA</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.data.items.map((admin) => (
                <AdminTableRow
                  key={admin.id}
                  admin={admin}
                  roles={roles.data?.roles ?? []}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <InviteAdminDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={roles.data?.roles ?? []}
      />
    </div>
  )
}

function AdminTableRow({ admin, roles }: { admin: AdminUser; roles: Role[] }) {
  return (
    <TableRow>
      {/* Admin — avatar + name + email */}
      <TableCell className="py-3">
        <div className="flex min-w-0 items-center gap-[11px]">
          <span
            aria-hidden="true"
            className="flex size-8 flex-none items-center justify-center rounded-full bg-brand-green text-[12px] font-extrabold text-white"
          >
            {admin.email.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold text-ink">
              {displayName(admin.email)}
            </div>
            <div className="truncate text-[11px] text-ink3">{admin.email}</div>
          </div>
        </div>
      </TableCell>

      {/* Role — dot + label */}
      <TableCell>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-ink">
          <span
            aria-hidden="true"
            className="size-2 flex-none rounded-full"
            style={{ background: roleDotColor(admin.role.name) }}
          />
          {admin.role.name}
        </span>
      </TableCell>

      {/* 2FA — enrolment state (label carries the meaning, not just colour) */}
      <TableCell>
        {admin.mfaEnabled ? (
          <span className="text-[11px] font-bold text-tok">Enrolled</span>
        ) : (
          <span className="text-[11px] font-bold text-ink3">Not enrolled</span>
        )}
      </TableCell>

      {/* Status pill */}
      <TableCell>
        <StatusBadge status={admin.status} />
      </TableCell>

      {/* Last login */}
      <TableCell className="text-[11.5px] text-ink2 tabular-nums">
        {formatDate(admin.lastLoginAt)}
      </TableCell>

      {/* Sensitive actions (step-up gated) */}
      <TableCell className="text-right">
        <AdminRowActions admin={admin} roles={roles} />
      </TableCell>
    </TableRow>
  )
}
