/**
 * /login — Log in to Handshake Agent.
 *
 * Server component — composition only, no business logic. Mirrors the
 * `/get-started` onboarding shell: on desktop, a green brand rail on the left
 * and a cream card with the two-step LoginForm on the right; on mobile, a green
 * brand band across the top (matching the onboarding's green treatment) above
 * the cream form (Task F4.2).
 */
import type { Metadata } from "next"
import { BrandMark } from "@/components/shared/brand-mark"
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
      className="grid min-h-svh grid-rows-[auto_1fr] bg-background lg:grid-cols-[400px_1fr] lg:grid-rows-none"
    >
      {/* Mobile brand band — the green top area (desktop shows the side rail instead). */}
      <div className="flex flex-col bg-[linear-gradient(168deg,var(--primary)_0%,var(--primary-deep)_100%)] px-6 pt-[60px] pb-8 text-primary-foreground lg:hidden">
        <div className="flex items-center gap-[11px]">
          <BrandMark size={40} />
          <span className="text-[17px] font-bold tracking-[-0.01em]">
            Handshake
          </span>
        </div>
        <h1 className="mt-7 text-[32px] leading-[1.08] font-extrabold tracking-[-0.03em]">
          Welcome back.
        </h1>
        <p className="mt-3 text-[15px] leading-[1.5] text-primary-foreground/80">
          Log in to pick up right where you left off.
        </p>
      </div>

      <AuthBrandRail
        className="hidden lg:flex"
        headline="Welcome back."
        subcopy="Log in to pick up right where you left off — buy, send and swap crypto from a chat."
      />

      <div className="flex items-center justify-center overflow-y-auto px-6 py-10 lg:p-12">
        <div className="w-full max-w-[460px]">
          <LoginForm />
        </div>
      </div>
    </main>
  )
}
