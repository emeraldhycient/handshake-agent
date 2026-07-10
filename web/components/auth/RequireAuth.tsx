"use client"

/**
 * RequireAuth — route guard for authenticated pages (Wave H: cookie refresh).
 *
 * Driven entirely by the auth store status, which the AuthProvider boot
 * rehydration resolves from the HttpOnly refresh cookie:
 * - `loading`       → show a loading branch (boot refresh still in flight).
 * - `authenticated` → render children.
 * - `anonymous`     → redirect to /login.
 *
 * Hydration: the store no longer reads localStorage, so its initial status is
 * `loading` on both server and client — no mismatch, so no mounted-gate needed.
 * The server renders the loading branch; the client hydrates to the same branch,
 * then the AuthProvider effect flips the status.
 *
 * Do NOT wrap public routes: /signup, /login, /verify-email, /kyc, /onboarding.
 */
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/lib/store/auth-store"

interface RequireAuthProps {
  children: React.ReactNode
}

export function RequireAuth({ children }: RequireAuthProps) {
  const router = useRouter()
  const status = useAuthStore((s) => s.status)

  useEffect(() => {
    if (status === "anonymous") {
      router.push("/login")
    }
  }, [status, router])

  // Boot rehydration in flight — the cookie refresh has not yet resolved.
  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  // No session — the redirect above is in flight; render nothing.
  if (status === "anonymous") {
    return null
  }

  return <>{children}</>
}
