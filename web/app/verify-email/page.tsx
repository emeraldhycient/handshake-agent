/**
 * /verify-email — Email verification page.
 *
 * Server component — composition only, no business logic.
 * Reads the `token` query param (awaited, as required by Next 16).
 * If token is present → renders VerifyEmailForm.
 * If absent → renders invalid-link empty state.
 */
import type { Metadata } from "next"
import Link from "next/link"
import { VerifyEmailForm } from "@/components/auth/VerifyEmailForm"
import type { VerifyEmailPageProps } from "@/types"

export const metadata: Metadata = {
  title: "Verify your email — Handshake Agent",
  description: "Verify your email address to activate your account.",
}

export default async function VerifyEmailPage({
  searchParams,
}: VerifyEmailPageProps) {
  // searchParams is a Promise in Next 16 — must await (sync access removed)
  const params = await searchParams
  const token = typeof params.token === "string" ? params.token.trim() : ""

  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-background px-4 py-12"
    >
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            Verify your email
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            One click away from activating your account.
          </p>
        </header>

        {token ? (
          <VerifyEmailForm token={token} />
        ) : (
          /* Empty / invalid-token state */
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-4 rounded-xl border border-destructive/30 bg-destructive/10 px-6 py-10 text-center"
          >
            <span className="text-4xl" aria-hidden="true">
              ⚠
            </span>
            <h2 className="text-lg font-semibold text-destructive">
              Invalid or expired link
            </h2>
            <p className="text-sm text-muted-foreground">
              This verification link is missing, invalid, or has already been
              used. Verification links are valid for 24 hours — request a fresh
              one to finish setting up your account.
            </p>
            <Link
              href="/signup"
              className="mt-1 inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Resend verification email
            </Link>
            <p className="text-xs text-muted-foreground">
              Don&apos;t worry — this won&apos;t create a duplicate account.
              We&apos;ll just send a fresh link to your email.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
