/**
 * /signup — Create a new Handshake Agent account.
 *
 * Server component — composition only, no business logic.
 * Renders a centred card layout with the SignupForm feature component.
 */
import type { Metadata } from "next"
import { SignupForm } from "@/components/auth/SignupForm"

export const metadata: Metadata = {
  title: "Sign up — Handshake Agent",
  description: "Create your Handshake Agent account.",
}

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            Create your account
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign up to start using Handshake Agent for crypto and payments.
          </p>
        </header>

        <SignupForm />
      </div>
    </main>
  )
}
