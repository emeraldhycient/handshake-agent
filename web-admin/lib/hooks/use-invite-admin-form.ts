"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  AdminInvitationCreateRequestSchema,
  type AdminInvitationCreateRequest,
} from "@handshake-agent/contracts"

import { toErrorMessage } from "@/lib/error-message"
import { useCreateInvitation } from "@/lib/query/hooks"
import type { InviteAdminDialogProps } from "@/types"

/**
 * View-model for the "Invite an admin" dialog. Owns the RHF form (email + role,
 * defaulting to the first role) and the create-invitation mutation. On success
 * the mutation carries the one-time `invitationToken` — exposed via `result` so
 * the dialog can show it once (it is never persisted in plaintext). `close`
 * resets both the form and the mutation so a reopened dialog starts clean.
 */
export function useInviteAdminForm({
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

  const onFormSubmit = handleSubmit(async (values) => {
    try {
      await invite.mutateAsync(values)
    } catch {
      // Surfaces via invite.error → serverError below.
    }
  })

  function close() {
    reset()
    invite.reset()
    onOpenChange(false)
  }

  return {
    open,
    register,
    errors,
    loading: isSubmitting || invite.isPending,
    serverError: toErrorMessage(invite.error),
    /** The one-time invitation result while the mutation is successful, else null. */
    result: invite.isSuccess ? invite.data : null,
    onFormSubmit,
    close,
    onDialogOpenChange: (next: boolean) => (next ? onOpenChange(true) : close()),
  }
}
