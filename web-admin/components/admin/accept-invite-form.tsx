"use client"

/**
 * AcceptInviteForm — sets a password for an invited admin.
 *
 * Reads the one-time `?token=` from the URL, validates a password (≥12 chars) +
 * confirmation client-side (AcceptInviteFormSchema), then POSTs to
 * /admin/invitations/accept. On success it redirects to /login so the new admin
 * signs in normally. Accepting does NOT establish a session.
 *
 * Strict layering: pure UI — no fetch, no axios.
 */
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter, useSearchParams } from "next/navigation"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useAcceptInvite } from "@/lib/query/auth"
import { AcceptInviteFormSchema, type AcceptInviteForm } from "@/lib/schemas"
import { toErrorMessage } from "@/lib/error-message"

export function AcceptInviteForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get("token") ?? ""

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AcceptInviteForm>({
    resolver: zodResolver(AcceptInviteFormSchema),
    defaultValues: { password: "", confirmPassword: "" },
  })

  const accept = useAcceptInvite()

  async function onSubmit(values: AcceptInviteForm) {
    try {
      await accept.mutateAsync({ token, password: values.password })
      router.push("/login")
    } catch {
      // Surfaces via accept.error below.
    }
  }

  const loading = isSubmitting || accept.isPending
  const serverError = toErrorMessage(accept.error)

  if (!token) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        This invitation link is missing its token. Ask your inviter to resend
        it.
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Accept invitation form"
      className="flex flex-col gap-5"
    >
      {serverError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {serverError}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="accept-password">New password</Label>
        <Input
          id="accept-password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          placeholder="At least 12 characters"
          disabled={loading}
          {...register("password")}
        />
        {errors.password && (
          <p role="alert" className="text-xs text-destructive">
            {errors.password.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="accept-confirm">Confirm password</Label>
        <Input
          id="accept-confirm"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.confirmPassword}
          placeholder="Re-enter your password"
          disabled={loading}
          {...register("confirmPassword")}
        />
        {errors.confirmPassword && (
          <p role="alert" className="text-xs text-destructive">
            {errors.confirmPassword.message}
          </p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={loading}
        aria-busy={loading}
        className="mt-1 w-full"
      >
        {loading ? "Setting password…" : "Accept invitation"}
      </Button>
    </form>
  )
}
