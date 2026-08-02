import { Skeleton } from "@/components/ui/skeleton"
import { RolePermissionMatrix } from "@/components/admin/role-permission-matrix"
import type { RoleMatrixSectionProps } from "@/types"

/**
 * The role permission matrix region — the "New role" CTA above the shared
 * `RolePermissionMatrix`, with its own four async branches (loading / error / empty /
 * data) resolved from the roles × permissions reads.
 */
export function RoleMatrixSection({
  loading,
  error,
  ready,
  empty,
  roles,
  permissions,
  onCreateRole,
  onRetry,
}: RoleMatrixSectionProps) {
  return (
    <>
      <div className="mb-1 flex items-center justify-end">
        <button
          type="button"
          onClick={onCreateRole}
          className="flex h-[32px] items-center gap-[6px] rounded-[10px] border border-line bg-card px-3 text-[12px] font-bold text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          + New role
        </button>
      </div>

      {loading && (
        <div
          className="rounded-[16px] border border-line bg-card px-5 py-[18px]"
          aria-busy="true"
        >
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-8 w-full rounded-[8px]" />
            ))}
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="rounded-[16px] border border-line bg-card px-5 py-8 text-center">
          <div className="text-[13.5px] font-bold text-tdn">
            Couldn&apos;t load the permission matrix
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 text-[12.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && empty && (
        <div className="rounded-[16px] border border-line bg-card px-5 py-8 text-center text-ink3">
          <div className="text-[13.5px] font-bold text-ink2">
            No roles to display
          </div>
        </div>
      )}

      {!loading && !error && ready && !empty && (
        <RolePermissionMatrix roles={roles} permissions={permissions} />
      )}
    </>
  )
}
