import { TableCell, TableRow } from "@/components/ui/table"
import { AdminRowActions } from "@/components/admin/admin-row-actions"
import { initialsOf } from "@/lib/avatar"
import { AVATAR_STRIPE } from "@/constants/admins"
import { formatLastLogin, roleDot } from "@/lib/admins/format"
import type { AdminRowProps } from "@/types"

/**
 * One admin table row (design line 6). The sensitive row actions (change role, suspend
 * / reactivate / offboard, reset 2FA) are the wired `AdminRowActions` — each runs its
 * step-up-gated mutation and invalidates the admins query on success. The `displayName`
 * is the primary label with the email beneath it.
 */
export function AdminRow({ admin, roles }: AdminRowProps) {
  const isActive = admin.status === "active"
  return (
    <TableRow>
      {/* Admin — striped avatar (initials from the display name) + name + email */}
      <TableCell>
        <div className="flex items-center gap-[11px]">
          <span
            aria-hidden="true"
            className="flex size-8 flex-none items-center justify-center rounded-full text-[11px] font-extrabold text-white"
            style={{ background: AVATAR_STRIPE }}
          >
            {initialsOf(admin.displayName)}
          </span>
          <div>
            <div className="text-[13px] font-bold text-ink">
              {admin.displayName}
            </div>
            <div className="text-[11px] text-ink3">{admin.email}</div>
          </div>
        </div>
      </TableCell>

      {/* Role — dot + label */}
      <TableCell>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-ink">
          <span
            aria-hidden="true"
            className="size-2 flex-none rounded-full"
            style={{ background: roleDot(admin.role.name) }}
          />
          {admin.role.name}
        </span>
      </TableCell>

      {/* 2FA — enrolment state (label carries the meaning, not just colour) */}
      <TableCell>
        {admin.mfaEnabled ? (
          <span className="text-[11px] font-bold text-tok">Enrolled</span>
        ) : (
          <span className="text-[11px] font-bold text-ink3">Not set</span>
        )}
      </TableCell>

      {/* Status pill */}
      <TableCell>
        {isActive ? (
          <span className="rounded-full bg-sok px-[9px] py-[2px] text-[10.5px] font-bold text-tok">
            Active
          </span>
        ) : (
          <span className="rounded-full bg-card2 px-[9px] py-[2px] text-[10.5px] font-bold text-ink2 capitalize">
            {admin.status}
          </span>
        )}
      </TableCell>

      {/* Last login — absolute stamp, or "Never" for an admin who has not signed in */}
      <TableCell className="text-[12px] text-ink2 tabular-nums">
        {formatLastLogin(admin.lastLoginAt)}
      </TableCell>

      {/* Row actions — reset 2FA + change role + suspend/reactivate/offboard, each
          RBAC-gated (permission + self-guard) inside AdminRowActions; a read-only
          operator sees a muted dash. All step-up-gated. */}
      <TableCell className="text-right">
        <div className="flex justify-end">
          <AdminRowActions admin={admin} roles={roles} />
        </div>
      </TableCell>
    </TableRow>
  )
}
