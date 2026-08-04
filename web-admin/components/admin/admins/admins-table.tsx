import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { AdminsTableProps } from "@/types"

import { AdminRow } from "./admin-row"

/**
 * The admin table card — a real `<table>` (shared shadcn primitive) whose container is
 * overflow-hidden: every cell sizes to its own content so nothing wraps mid-word. Four
 * async branches (loading / error / empty / data).
 */
export function AdminsTable({
  isLoading,
  isError,
  isSuccess,
  admins,
  roles,
  onRetry,
}: AdminsTableProps) {
  return (
    <div className="mb-4 overflow-hidden rounded-[16px] border border-line bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Admin</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>2FA</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last login</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Loading */}
          {isLoading &&
            [0, 1, 2, 3].map((i) => (
              <TableRow key={i} aria-busy="true">
                <TableCell>
                  <div className="flex items-center gap-[11px]">
                    <Skeleton className="size-8 flex-none rounded-full" />
                    <div>
                      <Skeleton className="h-3 w-28" />
                      <Skeleton className="mt-1.5 h-2.5 w-40" />
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Skeleton className="h-3 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-3 w-14" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-16 rounded-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-3 w-28" />
                </TableCell>
                <TableCell />
              </TableRow>
            ))}

          {/* Error */}
          {isError && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-[46px] text-center whitespace-normal"
              >
                <div className="text-[13.5px] font-bold text-tdn">
                  Couldn&apos;t load admins
                </div>
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-2 text-[12.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Try again
                </button>
              </TableCell>
            </TableRow>
          )}

          {/* Empty */}
          {isSuccess && admins.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-[46px] text-center whitespace-normal text-ink3"
              >
                <div className="text-[14px] font-bold text-ink2">
                  No admins yet
                </div>
                <div className="mt-1 text-[12.5px]">
                  Invite your first operator to get started.
                </div>
              </TableCell>
            </TableRow>
          )}

          {/* Data */}
          {isSuccess &&
            admins.map((admin) => (
              <AdminRow key={admin.id} admin={admin} roles={roles} />
            ))}
        </TableBody>
      </Table>
    </div>
  )
}
