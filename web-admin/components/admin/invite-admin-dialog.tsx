"use client"

/**
 * InviteAdminDialog — invite a new admin (email + role). Composition only: the RHF
 * form + create-invitation mutation live in `useInviteAdminForm`; on success the
 * one-time token is shown once via `InviteSuccess` (never persisted in plaintext).
 * Focus-trapped, Esc-closable.
 */
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
import { InviteSuccess } from "@/components/admin/invite-admin/invite-success"
import { useInviteAdminForm } from "@/lib/hooks/use-invite-admin-form"
import type { InviteAdminDialogProps } from "@/types/components"

export function InviteAdminDialog(props: InviteAdminDialogProps) {
  const {
    open,
    register,
    errors,
    loading,
    serverError,
    result,
    onFormSubmit,
    close,
    onDialogOpenChange,
  } = useInviteAdminForm(props)

  return (
    <Dialog open={open} onOpenChange={onDialogOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite an admin</DialogTitle>
          <DialogDescription>
            They&apos;ll receive a one-time link to set a password and join with
            the selected role.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <InviteSuccess
            email={result.email}
            token={result.invitationToken}
            onDone={close}
          />
        ) : (
          <form onSubmit={onFormSubmit} noValidate className="flex flex-col gap-4">
            {serverError && (
              <div
                role="alert"
                className="rounded-[10px] border border-sdn bg-sdn px-4 py-3 text-[13px] font-semibold text-tdn"
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
                <p role="alert" className="text-[11.5px] font-semibold text-tdn">
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
                {props.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </NativeSelect>
              {errors.roleId && (
                <p role="alert" className="text-[11.5px] font-semibold text-tdn">
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
