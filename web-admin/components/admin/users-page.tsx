"use client"

/**
 * UsersPage — the end-user management surface. A debounced search box + status /
 * tier filters drive a keyed `useEndUsers(query)`; results render in a paginated
 * table (email / status / KYC status / tier / a sim-swap flag badge). Clicking a
 * row opens the `UserDetail` drawer with the full aggregate.
 *
 * Cursor pagination: "Next" pushes the response's `nextCursor`; a back-stack of
 * cursors powers "Previous". Changing a filter resets paging.
 *
 * Four async branches on the users query: loading / error / empty / data.
 */
import { useEffect, useMemo, useState } from "react"
import { ShieldAlert } from "lucide-react"
import {
  AdminEndUserStatusSchema,
  KycTierSchema,
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
import { Label } from "@/components/ui/label"
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

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Users
        </h1>
      </div>

      {/* ── Search + filters ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-border bg-card p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-search">Search</Label>
          <Input
            id="user-search"
            className="w-64"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Email or user id"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-status">Status</Label>
          <NativeSelect
            id="user-status"
            className="w-44"
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
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-tier">KYC tier</Label>
          <NativeSelect
            id="user-tier"
            className="w-44"
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
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {usersQuery.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {usersQuery.isError && (
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Failed to load users
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {usersQuery.isSuccess && usersQuery.data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No users match these filters.
        </p>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {usersQuery.isSuccess && usersQuery.data.items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-[14px] border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>KYC status</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usersQuery.data.items.map((user) => (
                  <TableRow
                    key={user.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${user.email ?? user.id}`}
                    className="cursor-pointer focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() => setSelectedId(user.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        setSelectedId(user.id)
                      }
                    }}
                  >
                    <TableCell className="font-medium text-foreground">
                      {user.email ?? (
                        <span className="font-mono text-xs text-muted-foreground">
                          {user.id}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <UserStatusBadge status={user.status} />
                    </TableCell>
                    <TableCell>
                      <KycStatusBadge status={user.kycStatus} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.kycTier}
                    </TableCell>
                    <TableCell>
                      {user.simSwapFlagged && (
                        <Badge variant="destructive">
                          <ShieldAlert aria-hidden="true" />
                          SIM swap
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* ── Cursor pagination ──────────────────────────────────────── */}
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={cursors.length === 0}
              onClick={() => setCursors((prev) => prev.slice(0, -1))}
            >
              Previous
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
