/**
 * /login — Log in to Handshake Agent.
 *
 * Server component — composition only, no business logic.
 * Renders a centred card layout with the LoginForm feature component.
 */
import type { Metadata } from "next"
import { LoginForm } from "@/components/auth/LoginForm"

export const metadata: Metadata = {
  title: "Log in — Handshake Agent",
  description: "Log in to your Handshake Agent account.",
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Log in to your Handshake Agent account.
          </p>
        </header>

        <LoginForm />
      </div>
    </main>
  )
}
