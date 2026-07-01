/**
 * Single Axios instance for the admin API.
 *
 * Request interceptors (in order of registration):
 *   1. Idempotency-Key — sets a UUID on every non-GET request.
 *   2. Auth Bearer    — attaches the admin store's in-memory access token.
 *
 * Response interceptor:
 *   Normalises every error to `ApiError`, carrying the HTTP `status` and the
 *   server-echoed `code` (e.g. `ADMIN_STEP_UP_REQUIRED`) so the UI can branch on
 *   it. On any 401 it clears the admin session and (client-side) redirects to
 *   `/login`. There is NO refresh-token flow — admin sessions are short-lived
 *   and a 401 means re-login.
 *
 * Components and hooks must never import axios directly — use `api` from here
 * via the typed clients in `lib/api/admin.ts`.
 */

import axios, { type AxiosError } from "axios"
import { defaultAdminAuthStore } from "@/lib/store/admin-auth-store"

// ─── ApiError ───────────────────────────────────────────────────────────────────
// Extends Error with the HTTP status and the server's stable `code` discriminant
// so error-handling UI can branch (e.g. code === "ADMIN_STEP_UP_REQUIRED").

export class ApiError extends Error {
  status?: number
  code?: string
  constructor(message: string, status?: number, code?: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL,
})

// ─── Request interceptor 1 — Idempotency-Key ─────────────────────────────────────

api.interceptors.request.use((config) => {
  if (config.method && config.method.toUpperCase() !== "GET") {
    ;(config.headers as Record<string, string>)["Idempotency-Key"] ??=
      crypto.randomUUID()
  }
  return config
})

// ─── Request interceptor 2 — Auth Bearer ─────────────────────────────────────────

api.interceptors.request.use((config) => {
  const token = defaultAdminAuthStore.getState().accessToken
  if (token) {
    ;(config.headers as Record<string, string>)["Authorization"] =
      `Bearer ${token}`
  }
  return config
})

// ─── Response interceptor — 401 handling + error normalisation ───────────────────

interface ApiErrorBody {
  message?: string | string[]
  code?: string
}

function readMessage(body: ApiErrorBody | undefined, fallback: string): string {
  const raw = body?.message
  if (Array.isArray(raw)) return raw.join(", ")
  return raw ?? fallback
}

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorBody>) => {
    const status = error.response?.status
    const body = error.response?.data
    const code = body?.code

    // Any 401 → the admin session is unrecoverable (no refresh flow). Clear the
    // store and bounce to /login. Skip the redirect on the login endpoint itself
    // so a bad-credentials 401 surfaces inline instead of reloading the page.
    const isLoginEndpoint = error.config?.url?.includes("/auth/login")
    if (status === 401 && !isLoginEndpoint) {
      defaultAdminAuthStore.getState().clear()
      if (
        typeof window !== "undefined" &&
        window.location.pathname !== "/login"
      ) {
        window.location.assign("/login")
      }
    }

    const message = readMessage(body, error.message ?? "Unknown error")
    return Promise.reject(new ApiError(message, status, code))
  }
)
