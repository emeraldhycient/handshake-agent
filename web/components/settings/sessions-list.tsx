"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { ProfileSession } from "@handshake-agent/contracts"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useLogout } from "@/lib/query/auth"
import { useProfileSessions, useRevokeSession } from "@/lib/query/profile"
import { formatDate } from "@/lib/transaction/format"
import { toErrorMessage } from "@/lib/error-message"
import { ConfirmRevokeDialog } from "./confirm-revoke-dialog"

/**
 * Active sessions with per-row revoke. Revoking the session you are on is
 * allowed and behaves like logout (server already invalidated it; we clear
 * the client and land on /login).
 */
export function SessionsList() {
  const sessions = useProfileSessions()
  const revoke = useRevokeSession()
  const logout = useLogout()
  const router = useRouter()
  const [pendingRevoke, setPendingRevoke] = useState<ProfileSession | null>(
    null
  )

  async function handleConfirmRevoke() {
    if (!pendingRevoke) return
    const target = pendingRevoke
    try {
      await revoke.mutateAsync(target.id)
    } catch {
      return // surfaced inside the confirm dialog via revoke.error
    }
    setPendingRevoke(null)
    if (target.isCurrent) {
      logout.mutate(undefined, { onSettled: () => router.push("/login") })
    }
  }

  if (sessions.isLoading) {
    return (
      <div className="flex flex-col gap-2 px-5 py-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  if (sessions.isError || !sessions.data) {
    return (
      <p className="px-5 py-4 text-[12.5px] text-danger" role="alert">
        Could not load your sessions. Please refresh the page.
      </p>
    )
  }

  if (sessions.data.sessions.length === 0) {
    return (
      <p className="px-5 py-4 text-[12.5px] text-muted-foreground">
        No active sessions.
      </p>
    )
  }

  return (
    <ul aria-label="Active sessions">
      {sessions.data.sessions.map((session) => (
        <li
          key={session.id}
          className="flex items-center gap-3 border-b border-border px-5 py-[13px] last:border-b-0"
        >
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="capitalize">{session.channel}</span>
              {session.isCurrent && (
                <span className="rounded-full bg-info-muted px-2 py-0.5 text-[10.5px] font-bold text-info">
                  This device
                </span>
              )}
            </p>
            {session.userAgent && (
              <p className="truncate text-[12px] text-muted-foreground">
                {session.userAgent}
              </p>
            )}
            <p className="text-[11.5px] text-muted-foreground">
              Signed in {formatDate(session.createdAt)}
              {session.lastUsedAt
                ? ` · Last used ${formatDate(session.lastUsedAt)}`
                : ""}
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setPendingRevoke(session)}
            aria-label={`Revoke ${session.channel} session`}
          >
            Revoke
          </Button>
        </li>
      ))}
      <ConfirmRevokeDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null)
        }}
        title="Revoke this session?"
        description={
          pendingRevoke?.isCurrent
            ? "This is the session you're using now — you'll be signed out on this device."
            : "The device on that session will be signed out immediately."
        }
        confirmLabel="Yes, revoke"
        pending={revoke.isPending || logout.isPending}
        error={revoke.isError ? toErrorMessage(revoke.error) : null}
        onConfirm={handleConfirmRevoke}
      />
    </ul>
  )
}
