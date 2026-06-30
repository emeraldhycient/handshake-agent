"use client"

/**
 * InviteAdminDialog — invite a new admin (email + role). react-hook-form +
 * zodResolver(AdminInvitationCreateRequestSchema). On success the API returns a
 * one-time invitation token (shown once so the inviter can hand it to the
 * invitee — it is never persisted in plaintext). Focus-trapped, Esc-closable.
 */
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  AdminInvitationCreateRequestSchema,
  type AdminInvitationCreateRequest,
} from "@handshake-agent/contracts"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { useCreateInvitation } from "@/lib/query/hooks"
import { ApiError } from "@/lib/api/client"
import type { InviteAdminDialogProps } from "@/types/components"

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

export function InviteAdminDialog({
  open,
  onOpenChange,
  roles,
}: InviteAdminDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AdminInvitationCreateRequest>({
    resolver: zodResolver(AdminInvitationCreateRequestSchema),
    defaultValues: { email: "", roleId: roles[0]?.id ?? "" },
  })

  const invite = useCreateInvitation()

  async function onSubmit(values: AdminInvitationCreateRequest) {
    try {
      await invite.mutateAsync(values)
    } catch {
      // Surfaces via invite.error below.
    }
  }

  function close() {
    reset()
    invite.reset()
    onOpenChange(false)
  }

  const loading = isSubmitting || invite.isPending
  const serverError = errorMessage(invite.error)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite an admin</DialogTitle>
          <DialogDescription>
            They&apos;ll receive a one-time link to set a password and join with
            the selected role.
          </DialogDescription>
        </DialogHeader>

        {/* ── Success: show the one-time token ─────────────────────────────── */}
        {invite.isSuccess ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-foreground">
              Invitation created for{" "}
              <span className="font-semibold">{invite.data.email}</span>. Share
              this one-time token with them — it won&apos;t be shown again:
            </p>
            <code className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs break-all">
              {invite.data.invitationToken}
            </code>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit(onSubmit)}
            noValidate
            className="flex flex-col gap-4"
          >
            {serverError && (
              <div
                role="alert"
                className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {serverError}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                aria-invalid={!!errors.email}
                placeholder="new.admin@example.com"
                disabled={loading}
                {...register("email")}
              />
              {errors.email && (
                <p role="alert" className="text-xs text-destructive">
                  {errors.email.message ?? "Enter a valid email address"}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <NativeSelect
                id="invite-role"
                aria-invalid={!!errors.roleId}
                disabled={loading}
                {...register("roleId")}
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </NativeSelect>
              {errors.roleId && (
                <p role="alert" className="text-xs text-destructive">
                  {errors.roleId.message ?? "Select a role"}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={close}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading} aria-busy={loading}>
                {loading ? "Inviting…" : "Send invitation"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
