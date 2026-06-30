"use client"

/**
 * Dashboard — the admin landing surface. Welcomes the operator and summarises
 * their resolved identity, role, MFA state, and effective permission grants from
 * useAdminMe(). Offers MFA enrollment when not yet enrolled. Four async branches:
 * loading / error / empty(n.a.) / data.
 */
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { MfaEnrollDialog } from "@/components/admin/mfa-enroll-dialog"
import { useAdminMe } from "@/lib/query/hooks"

export function Dashboard() {
  const me = useAdminMe()
  const [mfaOpen, setMfaOpen] = useState(false)

  // ── Loading ──────────────────────────────────────────────────────────────
  if (me.isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full max-w-xl rounded-[14px]" />
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (me.isError || !me.data) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Could not load your admin profile
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      </div>
    )
  }

  const admin = me.data

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div>
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Welcome
        </h1>
        <p className="text-sm text-muted-foreground">{admin.email}</p>
      </div>

      <div className="max-w-2xl rounded-[14px] border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{admin.role.name}</Badge>
          <Badge variant={admin.status === "active" ? "default" : "secondary"}>
            {admin.status}
          </Badge>
          <Badge variant={admin.mfaEnabled ? "default" : "destructive"}>
            {admin.mfaEnabled ? "MFA enabled" : "MFA off"}
          </Badge>
          {!admin.mfaEnabled && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => setMfaOpen(true)}
            >
              Set up MFA
            </Button>
          )}
        </div>

        <Separator className="my-4" />

        <p className="mb-2 text-xs font-bold tracking-widest text-muted-foreground uppercase">
          Effective permissions ({admin.permissions.length})
        </p>
        {admin.permissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No permissions granted.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {admin.permissions.map((permission) => (
              <li
                key={permission}
                className="font-mono text-[11px] text-muted-foreground"
              >
                {permission}
              </li>
            ))}
          </ul>
        )}
      </div>

      <MfaEnrollDialog open={mfaOpen} onOpenChange={setMfaOpen} />
    </div>
  )
}
