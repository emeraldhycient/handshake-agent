"use client"

/**
 * UsersPage — the end-user directory (design §6, `screens/Users.html`), WIRED to
 * `useEndUsers`. Orchestrator: pulls the view-model from `useUsersDirectory` and
 * composes the header, filter row, contextual bulk bar, the 7-column table, and the
 * cursor pager. Nothing here moves money (§3.1) — the bulk Tag/Message ops are
 * step-up-guarded annotations / outbox enqueues (Phase 7).
 */
import { useRouter } from "next/navigation"

import { useUsersDirectory } from "@/lib/hooks/use-users-directory"
import { UsersHeader } from "@/components/admin/users/users-header"
import { UsersFilterBar } from "@/components/admin/users/users-filter-bar"
import { UsersBulkBar } from "@/components/admin/users/users-bulk-bar"
import { UsersTable } from "@/components/admin/users/users-table"
import { CursorPaginator } from "@/components/admin/cursor-paginator"
import { MAX_WIDTH } from "@/constants/users"

export function UsersPage() {
  const router = useRouter()
  const d = useUsersDirectory()

  return (
    <div
      data-screen-label="Users"
      className="mx-auto px-[30px] pt-[26px] pb-[60px]"
      style={{ maxWidth: MAX_WIDTH }}
    >
      <UsersHeader
        shown={d.rows.length}
        total={d.total}
        moreAvailable={d.canNext}
        exporting={d.exporting}
        onExport={() => void d.onExport()}
      />

      <div className="overflow-hidden rounded-[16px] border border-line bg-card">
        <UsersFilterBar
          search={d.search}
          onSearchChange={d.onSearchChange}
          kyc={d.kyc}
          onKycChange={d.onKycChange}
          tier={d.tier}
          onTierChange={d.onTierChange}
          risk={d.risk}
          onToggleRisk={d.toggleRisk}
        />

        {d.selected.length > 0 && (
          <UsersBulkBar
            count={d.selected.length}
            exporting={d.exporting}
            onExport={() => void d.onExport()}
            selectedIds={d.selected}
            onActionDone={d.clearSelection}
            onClear={d.clearSelection}
          />
        )}

        <UsersTable
          rows={d.rows}
          isLoading={d.isLoading}
          isError={d.isError}
          isSuccess={d.isSuccess}
          allSelected={d.allSelected}
          selectedIds={d.selected}
          onToggleSelectAll={d.toggleSelectAll}
          onToggleSelect={d.toggleSelect}
          onRetry={() => void d.refetch()}
          onOpen={(id) => router.push(`/users/${id}`)}
        />
      </div>

      {d.isSuccess && d.rows.length > 0 && (d.canPrev || d.canNext) && (
        <CursorPaginator
          pageIndex={d.pageIndex}
          canPrev={d.canPrev}
          canNext={d.canNext}
          busy={d.isFetching}
          onPrev={d.goPrev}
          onNext={d.goNext}
          leftLabel={`Showing ${d.rows.length} · page ${d.pageIndex}`}
        />
      )}
    </div>
  )
}
