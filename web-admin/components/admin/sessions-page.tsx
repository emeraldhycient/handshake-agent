"use client"

/**
 * SessionsPage — the signed-in admin's active sessions, with a revoke action per
 * row. Revoked / expired sessions are flagged. Four async branches on the
 * sessions query: loading / error / empty / data.
 *
 * Presentation follows the design's Security/sessions pattern (§6.3): a single
 * "Active sessions" card whose body is a list of rows — a status dot + the
 * device/user-agent (with session meta) + a mono `ip · expires` sub-line + a
 * per-row Revoke text-button. Revoked/expired rows are flagged with a status pill.
 */
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useSessions, useRevokeSession } from "@/lib/query/hooks"
import type { AdminSessionView } from "@handshake-agent/contracts"

// Session lifecycle → status pill (§5 status→token map) + a dot color token +
// whether the row is still revocable.
function sessionState(session: AdminSessionView): {
  label: string
  variant: React.ComponentProps<typeof Badge>["variant"]
  dotClass: string
  active: boolean
} {
  if (session.revokedAt)
    return {
      label: "revoked",
      variant: "neutral",
      dotClass: "bg-ink3",
      active: false,
    }
  if (new Date(session.expiresAt).getTime() < Date.now())
    return {
      label: "expired",
      variant: "warn",
      dotClass: "bg-twn",
      active: false,
    }
  return {
    label: "active",
    variant: "success",
    dotClass: "bg-tok",
    active: true,
  }
}

function SessionRow({ session }: { session: AdminSessionView }) {
  const revoke = useRevokeSession()
  const state = sessionState(session)
  const device = session.userAgent ?? "Unknown device"

  return (
    <div className="flex items-center gap-[11px] border-b border-line2 py-[11px] last:border-0">
      <span
        className={`size-2 flex-none rounded-full ${state.dotClass}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12.5px] font-semibold text-ink">
            {device}
          </span>
          <Badge variant={state.variant}>{state.label}</Badge>
          {session.stepUpCompletedAt && (
            <Badge variant="info">stepped up</Badge>
          )}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-ink3 tabular-nums">
          {session.ipAddress ?? "—"} · expires{" "}
          {new Date(session.expiresAt).toLocaleString()}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-[11.5px] font-bold text-ink2"
        disabled={!state.active || revoke.isPending}
        onClick={() => revoke.mutate(session.id)}
        aria-label={`Revoke session ${session.id}`}
      >
        {revoke.isPending ? "Revoking…" : "Revoke"}
      </Button>
    </div>
  )
}

export function SessionsPage() {
  const sessions = useSessions()

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-1 flex-col gap-4 overflow-y-auto px-[30px] py-[26px]">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Sessions
        </h1>
        <p className="mt-1 text-[13.5px] text-ink2">
          Your active console sessions · revoke any device you no longer trust.
        </p>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {sessions.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-12 w-full rounded-[16px]" />
          <Skeleton className="h-12 w-full rounded-[16px]" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {sessions.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn/40 p-5 text-center">
          <p className="text-[13px] font-bold text-tdn">
            Failed to load sessions
          </p>
          <p className="mt-1 text-[12px] text-ink3">Please refresh the page.</p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {sessions.isSuccess && sessions.data.items.length === 0 && (
        <div className="rounded-[16px] border border-line bg-card p-8 text-center">
          <p className="text-[14px] font-bold text-ink">No active sessions</p>
          <p className="mt-1 text-[12.5px] text-ink3">
            There are no sessions bound to your account.
          </p>
        </div>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {sessions.isSuccess && sessions.data.items.length > 0 && (
        <Card>
          <div className="text-[13px] font-extrabold text-ink">
            Active sessions
          </div>
          <div className="-mt-2 flex flex-col">
            {sessions.data.items.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
