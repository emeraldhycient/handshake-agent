"use client"

/**
 * VerifyEmailForm — feature component for the /verify-email page.
 *
 * Receives the token from props (injected by the page from searchParams).
 * Uses a button-click approach (not silent on-mount) so tests can control it.
 *
 * Strict layering: pure UI — no fetch, no axios, no business logic.
 */
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { useVerifyEmail } from "@/lib/query/auth"
import type { VerifyEmailFormProps } from "@/types/components"

export function VerifyEmailForm({ token }: VerifyEmailFormProps) {
  const { mutateAsync, isPending, isSuccess, error } = useVerifyEmail()

  async function handleVerify() {
    try {
      await mutateAsync({ token })
    } catch {
      // Error surfaces via mutation.error — rendered below.
    }
  }

  // ─── Success state ──────────────────────────────────────────────────────────

  if (isSuccess) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-4 rounded-xl border border-success bg-success/10 px-6 py-10 text-center"
      >
        <span className="text-4xl" aria-hidden="true">
          ✓
        </span>
        <h2 className="text-lg font-semibold text-foreground">
          Email verified!
        </h2>
        <p className="text-sm text-muted-foreground">
          Your account is ready. You can now log in.
        </p>
        <Link
          href="/login"
          className="mt-2 inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Continue to login
        </Link>
      </div>
    )
  }

  // ─── Error state ────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="flex flex-col items-center gap-4 rounded-xl border border-destructive/30 bg-destructive/10 px-6 py-10 text-center"
      >
        <span className="text-4xl" aria-hidden="true">
          ✕
        </span>
        <h2 className="text-lg font-semibold text-destructive">
          Verification failed
        </h2>
        <p className="text-sm text-muted-foreground">
          This link is invalid or has expired. Please sign up again to get a new
          verification email.
        </p>
        <Link
          href="/signup"
          className="text-sm font-medium text-primary underline underline-offset-2"
        >
          Sign up again
        </Link>
      </div>
    )
  }

  // ─── Default state — prompt to verify ──────────────────────────────────────

  return (
    <div className="flex flex-col items-center gap-6 rounded-xl border border-border bg-card px-6 py-10 text-center">
      <span className="text-4xl" aria-hidden="true">
        ✉
      </span>
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Verify your email
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Click the button below to confirm your email address and activate your
          account.
        </p>
      </div>
      <Button
        type="button"
        size="lg"
        disabled={isPending}
        aria-busy={isPending}
        onClick={handleVerify}
        className="w-full"
      >
        {isPending ? "Verifying…" : "Verify email"}
      </Button>
    </div>
  )
}
