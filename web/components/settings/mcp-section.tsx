"use client"

import { useState } from "react"
import type { PatListItem, PatScope } from "@handshake-agent/contracts"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { usePats, useRevokePat } from "@/lib/query/profile"
import { formatDate } from "@/lib/transaction/format"
import { toErrorMessage } from "@/lib/error-message"
import { PAT_SCOPE_OPTIONS } from "@/constants/settings"
import { ConfirmRevokeDialog } from "./confirm-revoke-dialog"
import { CreateTokenDialog } from "./create-token-dialog"
import { McpConnectionDocs } from "./mcp-connection-docs"

function scopesLabel(scopes: PatScope[]): string {
  return scopes
    .map((s) => PAT_SCOPE_OPTIONS.find((o) => o.scope === s)?.label ?? s)
    .join(" · ")
}

function TokenRow({
  token,
  onRevoke,
}: {
  token: PatListItem
  onRevoke: (token: PatListItem) => void
}) {
  return (
    <li className="flex items-center gap-3 border-b border-border px-5 py-[13px] last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {token.label}
        </p>
        <p className="text-[12px] text-muted-foreground">
          {scopesLabel(token.scopes)}
        </p>
        <p className="text-[11.5px] text-muted-foreground">
          Created {formatDate(token.createdAt)}
          {token.lastUsedAt
            ? ` · Last used ${formatDate(token.lastUsedAt)}`
            : " · Never used"}
          {token.expiresAt
            ? ` · Expires ${formatDate(token.expiresAt)}`
            : " · No expiry"}
        </p>
      </div>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => onRevoke(token)}
        aria-label={`Revoke ${token.label}`}
      >
        Revoke
      </Button>
    </li>
  )
}

/**
 * Connected agents (MCP): personal-access-token list + create/revoke, and the
 * connection docs. Tokens are read/propose-only — execution always comes back
 * to PIN + step-up in this app (§3.1).
 */
export function McpSection() {
  const pats = usePats()
  const revoke = useRevokePat()
  const [creating, setCreating] = useState(false)
  const [pendingRevoke, setPendingRevoke] = useState<PatListItem | null>(null)

  async function handleConfirmRevoke() {
    if (!pendingRevoke) return
    try {
      await revoke.mutateAsync(pendingRevoke.id)
    } catch {
      return // surfaced inside the confirm dialog via revoke.error
    }
    setPendingRevoke(null)
  }

  return (
    <div className="overflow-hidden rounded-[16px] border border-border bg-card">
      <div className="flex items-center border-b border-border px-5 py-[13px]">
        <p className="flex-1 text-xs font-bold tracking-widest text-muted-foreground uppercase">
          Connected agents (MCP)
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          Create token
        </Button>
      </div>
      {pats.isLoading ? (
        <div className="flex flex-col gap-2 px-5 py-4">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : pats.isError || !pats.data ? (
        <p className="px-5 py-4 text-[12.5px] text-danger" role="alert">
          Could not load your tokens. Please refresh the page.
        </p>
      ) : pats.data.tokens.length === 0 ? (
        <p className="px-5 py-4 text-[12.5px] text-muted-foreground">
          No connected agents yet. Create a token to let an AI agent read your
          account and propose transactions.
        </p>
      ) : (
        <ul aria-label="Personal access tokens">
          {pats.data.tokens.map((token) => (
            <TokenRow
              key={token.id}
              token={token}
              onRevoke={setPendingRevoke}
            />
          ))}
        </ul>
      )}
      <McpConnectionDocs />
      <CreateTokenDialog open={creating} onOpenChange={setCreating} />
      <ConfirmRevokeDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null)
        }}
        title="Revoke this token?"
        description="The agent using it will lose access immediately. This cannot be undone."
        confirmLabel="Yes, revoke"
        pending={revoke.isPending}
        error={revoke.isError ? toErrorMessage(revoke.error) : null}
        onConfirm={handleConfirmRevoke}
      />
    </div>
  )
}
