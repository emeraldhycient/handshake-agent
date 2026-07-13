/**
 * /login — Log in to Handshake Agent.
 *
 * Server component — composition only, no business logic. Mirrors the
 * `/get-started` onboarding shell: a green brand rail on the left (desktop)
 * and a cream card holding the two-step LoginForm on the right, so login and
 * signup read as one family (Task F4.2).
 */
import type { Metadata } from "next"
import { AuthBrandRail } from "@/components/auth/AuthBrandRail"
import { LoginForm } from "@/components/auth/LoginForm"

export const metadata: Metadata = {
  title: "Log in — Handshake Agent",
  description: "Log in to your Handshake Agent account.",
}

export default function LoginPage() {
  return (
    <main
      id="main-content"
      className="grid min-h-svh bg-background lg:grid-cols-[400px_1fr]"
    >
      <AuthBrandRail
        className="hidden lg:flex"
        headline="Welcome back."
        subcopy="Log in to pick up right where you left off — buy, send and swap crypto from a chat."
      />

      <div className="flex items-center justify-center overflow-y-auto px-6 py-12 lg:p-12">
        <div className="w-full max-w-[460px]">
          <LoginForm />
        </div>
      </div>
    </main>
  )
}
