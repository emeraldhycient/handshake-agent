"use client"

/**
 * UsersPage — the end-user management surface. A debounced search box + status /
 * tier filters drive a keyed `useEndUsers(query)`; results render in a paginated
 * table (customer identity / KYC status + tier / a sim-swap flag chip /
 * registered). Clicking a row opens the `UserDetail` drawer with the full
 * aggregate.
 *
 * Cursor pagination: "Next" pushes the response's `nextCursor`; a back-stack of
 * cursors powers "Previous". Changing a filter resets paging.
 *
 * Four async branches on the users query: loading / error / empty / data.
 */
import { useEffect, useMemo, useState } from "react"
import { Search, ShieldAlert, Users as UsersIcon } from "lucide-react"
import {
  AdminEndUserStatusSchema,
  KycTierSchema,
  type AdminEndUserListItem,
  type AdminEndUserSearchQuery,
} from "@handshake-agent/contracts"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  KycStatusBadge,
  UserStatusBadge,
} from "@/components/admin/user-status-badge"
import { UserDetail } from "@/components/admin/user-detail"
import { useEndUsers } from "@/lib/query/hooks"

const STATUSES = AdminEndUserStatusSchema.options
const TIERS = KycTierSchema.options
const PAGE_LIMIT = 25

/** Avatar initial derived from the available identity (email or id). */
function initialOf(user: AdminEndUserListItem): string {
  const source = user.email ?? user.id
  return source.charAt(0).toUpperCase()
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function UsersPage() {
  const [searchInput, setSearchInput] = useState("")
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [kycTier, setKycTier] = useState("")
  // Cursor back-stack: index N is the cursor that loaded the current page; we
  // push nextCursor on "Next" and pop on "Previous".
  const [cursors, setCursors] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Debounce the free-text search (≥200ms, root §13.7) and reset paging on it.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(searchInput.trim())
      setCursors([])
    }, 250)
    return () => clearTimeout(id)
  }, [searchInput])

  const cursor = cursors[cursors.length - 1]
  const params = useMemo<AdminEndUserSearchQuery>(
    () => ({
      ...(query ? { query } : {}),
      ...(status
        ? { status: status as AdminEndUserSearchQuery["status"] }
        : {}),
      ...(kycTier
        ? { kycTier: kycTier as AdminEndUserSearchQuery["kycTier"] }
        : {}),
      ...(cursor ? { cursor } : {}),
      limit: PAGE_LIMIT,
    }),
    [query, status, kycTier, cursor]
  )

  const usersQuery = useEndUsers(params)

  function resetPaging() {
    setCursors([])
  }

  const shownCount = usersQuery.data?.items.length ?? 0
  const pageNumber = cursors.length + 1

  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-1 flex-col gap-4 overflow-y-auto px-[30px] py-[26px]">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Users
          </h1>
          <p className="mt-1 text-[13.5px] text-ink2">
            <span className="tabular-nums">{shownCount}</span>{" "}
            {shownCount === 1 ? "customer" : "customers"} shown
          </p>
        </div>
        <Button variant="outline" size="lg" disabled={shownCount === 0}>
          Export CSV
        </Button>
      </div>

      {/* ── Search + filters ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex h-[38px] min-w-[230px] flex-1 items-center gap-2 rounded-[11px] border border-line bg-card px-3">
          <Search aria-hidden="true" className="size-[15px] text-ink3" />
          <Input
            aria-label="Search users"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Name, email, phone…"
            className="h-auto flex-1 border-none bg-transparent px-0 focus-visible:ring-0"
          />
        </div>
        <NativeSelect
          aria-label="Filter by status"
          className="h-[38px] w-auto min-w-[150px] bg-card"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            resetPaging()
          }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Filter by KYC tier"
          className="h-[38px] w-auto min-w-[150px] bg-card"
          value={kycTier}
          onChange={(e) => {
            setKycTier(e.target.value)
            resetPaging()
          }}
        >
          <option value="">All tiers</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </NativeSelect>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {usersQuery.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-[52px] w-full rounded-[11px]" />
          <Skeleton className="h-[52px] w-full rounded-[11px]" />
          <Skeleton className="h-[52px] w-full rounded-[11px]" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {usersQuery.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn/40 p-5 text-center">
          <p className="text-sm font-bold text-tdn">Failed to load users</p>
          <p className="mt-1 text-xs text-ink3">Please refresh the page.</p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {usersQuery.isSuccess && usersQuery.data.items.length === 0 && (
        <div className="rounded-[16px] border border-line bg-card px-5 py-[60px] text-center">
          <span className="mx-auto flex size-11 items-center justify-center rounded-[12px] bg-card2 text-ink3">
            <UsersIcon aria-hidden="true" className="size-5" />
          </span>
          <p className="mt-3 text-[14px] font-bold text-ink2">
            No users match these filters
          </p>
          <p className="mt-1 text-[12.5px] text-ink3">
            Try clearing the status or tier filters, or your search.
          </p>
        </div>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {usersQuery.isSuccess && usersQuery.data.items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-[16px] border border-line bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>KYC</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead className="text-right">Registered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usersQuery.data.items.map((user) => (
                  <TableRow
                    key={user.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${user.email ?? user.id}`}
                    className="cursor-pointer focus-visible:bg-hov focus-visible:outline-none"
                    onClick={() => setSelectedId(user.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        setSelectedId(user.id)
                      }
                    }}
                  >
                    <TableCell className="py-3">
                      <div className="flex min-w-0 items-center gap-[11px]">
                        <span
                          aria-hidden="true"
                          className="flex size-8 flex-none items-center justify-center rounded-full bg-brand-green text-[12px] font-extrabold text-white"
                        >
                          {initialOf(user)}
                        </span>
                        <div className="min-w-0">
                          {user.email ? (
                            <div className="truncate text-[13px] font-bold text-ink">
                              {user.email}
                            </div>
                          ) : (
                            <div className="truncate font-mono text-[12px] font-bold text-ink3">
                              {user.id}
                            </div>
                          )}
                          <div className="truncate font-mono text-[11px] text-ink3">
                            {user.id.slice(0, 8)}…
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <UserStatusBadge status={user.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-0.5">
                        <KycStatusBadge status={user.kycStatus} />
                        <span className="text-[10px] text-ink3">
                          {user.kycTier}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.simSwapFlagged ? (
                        <Badge variant="danger">
                          <ShieldAlert aria-hidden="true" />
                          SIM swap
                        </Badge>
                      ) : (
                        <span className="text-[11.5px] text-ink3">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-[11.5px] text-ink2 tabular-nums">
                      {formatDate(user.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* ── Cursor pagination (shared style §5) ────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line2 px-1 pt-3.5">
            <div className="text-[12px] text-ink3 tabular-nums">
              Page {pageNumber} · {shownCount} shown
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={cursors.length === 0}
                onClick={() => setCursors((prev) => prev.slice(0, -1))}
              >
                Prev
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!usersQuery.data.nextCursor}
                onClick={() =>
                  setCursors((prev) =>
                    usersQuery.data.nextCursor
                      ? [...prev, usersQuery.data.nextCursor]
                      : prev
                  )
                }
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <UserDetail
        userId={selectedId}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      />
    </div>
  )
}
