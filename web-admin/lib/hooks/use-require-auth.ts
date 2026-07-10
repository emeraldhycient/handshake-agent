"use client"

/**
 * useRequireAuth — the authentication half of the centralized admin guard, and
 * the app's boot-rehydration path (Wave H — HttpOnly cookie session).
 *
 * On a fresh load the in-memory store has no session (there is no token in JS —
 * the session lives in the HttpOnly `ha_admin_session` cookie). This hook probes
 * GET /admin/me ONCE with the cookie and maps the async result to a phase — the
 * four branches collapse to three because a failed/empty probe both mean "log in":
 *
 *  - "pending"        → probe in flight (or not-yet-mounted); render nothing.
 *  - "authenticated"  → store authenticated (probe succeeded, or just logged in).
 *  - "redirecting"    → no valid session (probe 401'd, or the store was cleared
 *                       by logout / a 401 interceptor); a /login redirect is in flight.
 *
 * The probe is one-shot and skipped entirely when the store is already
 * authenticated (the login flow populates it), so logout — which clears the
 * store — routes straight to /login without a doomed re-probe.
 */
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"

import { useAdminAuthStore } from "@/lib/store/admin-auth-store"
import { getMe } from "@/lib/api/admin"
import { qk } from "@/lib/query/keys"

export type AuthPhase = "pending" | "redirecting" | "authenticated"

type ProbePhase = "loading" | "settled" | "failed"

export function useRequireAuth(): AuthPhase {
  const router = useRouter()
  const queryClient = useQueryClient()
  const status = useAdminAuthStore((s) => s.status)
  const setSession = useAdminAuthStore((s) => s.setSession)

  const authenticated = status === "authenticated"

  // Boot probe: if we mount without an in-memory session, resolve it by hitting
  // /admin/me with the cookie. Initialised to "settled" when the store is already
  // authenticated (the login flow populates it) so that path never probes.
  const [probe, setProbe] = useState<ProbePhase>(
    authenticated ? "settled" : "loading"
  )

  // One-shot guard: the probe fires exactly once per mount (StrictMode-safe — a
  // ref survives the transient double-invoke, so we never launch two requests).
  const probedRef = useRef(authenticated)

  useEffect(() => {
    if (probedRef.current) return
    probedRef.current = true

    getMe()
      .then((admin) => {
        // Seed the shared me query so components (AppShell, RouteGuard) don't
        // refetch, then promote the store to authenticated.
        queryClient.setQueryData(qk.me, admin)
        setSession({ admin })
        setProbe("settled")
      })
      .catch(() => {
        // The client interceptor already cleared the store + may hard-redirect
        // on the 401; mark the probe failed so we render the redirecting branch.
        setProbe("failed")
      })
  }, [queryClient, setSession])

  // Anonymous + the boot probe still running → wait. Anything else with an
  // anonymous store (probe failed, or the store was cleared by logout / a 401)
  // means there is no valid session → redirect.
  const pending = !authenticated && probe === "loading"
  const redirecting = !authenticated && !pending

  useEffect(() => {
    if (redirecting) router.replace("/login")
  }, [redirecting, router])

  if (authenticated) return "authenticated"
  if (pending) return "pending"
  return "redirecting"
}
