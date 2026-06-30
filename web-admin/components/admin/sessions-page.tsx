"use client"

/**
 * SessionsPage — the signed-in admin's active sessions, with a revoke action per
 * row. Revoked / expired sessions are flagged. Four async branches on the
 * sessions query: loading / error / empty / data.
 */
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useSessions, useRevokeSession } from "@/lib/query/hooks"
import type { AdminSessionView } from "@/lib/schemas"

function sessionState(session: AdminSessionView): {
  label: string
  variant: React.ComponentProps<typeof Badge>["variant"]
  active: boolean
} {
  if (session.revokedAt)
    return { label: "revoked", variant: "outline", active: false }
  if (new Date(session.expiresAt).getTime() < Date.now())
    return { label: "expired", variant: "secondary", active: false }
  return { label: "active", variant: "default", active: true }
}

function SessionRow({ session }: { session: AdminSessionView }) {
  const revoke = useRevokeSession()
  const state = sessionState(session)

  return (
    <TableRow>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {session.id}
      </TableCell>
      <TableCell>
        <Badge variant={state.variant}>{state.label}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {new Date(session.expiresAt).toLocaleString()}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {session.stepUpCompletedAt ? "Yes" : "No"}
      </TableCell>
      <TableCell className="max-w-xs truncate text-muted-foreground">
        {session.ipAddress ?? "—"}
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="destructive"
          disabled={!state.active || revoke.isPending}
          onClick={() => revoke.mutate(session.id)}
          aria-label={`Revoke session ${session.id}`}
        >
          {revoke.isPending ? "Revoking…" : "Revoke"}
        </Button>
      </TableCell>
    </TableRow>
  )
}

export function SessionsPage() {
  const sessions = useSessions()

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
        Sessions
      </h1>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {sessions.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {sessions.isError && (
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Failed to load sessions
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {sessions.isSuccess && sessions.data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">No active sessions.</p>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {sessions.isSuccess && sessions.data.items.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Stepped up</TableHead>
                <TableHead>IP</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.data.items.map((session) => (
                <SessionRow key={session.id} session={session} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
