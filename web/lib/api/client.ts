/**
 * Single Axios instance for the real (non-mock) API.
 *
 * Request interceptor:  sets Idempotency-Key on every non-GET request.
 * Response interceptor: normalises error shape to { message }.
 *
 * Components and hooks must never import axios directly — use `api` from here
 * or, better, import `gateway` (which picks mock vs real at build/runtime).
 */

import axios, { type AxiosError } from "axios"

// ─── ApiError ─────────────────────────────────────────────────────────────────
// Extends Error with an optional HTTP status so error-handling UI can branch on
// e.g. 401 (unauthenticated), 402 (payment required), 422 (validation), etc.

export class ApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api",
})

// ─── Request interceptor — Idempotency-Key ────────────────────────────────────

api.interceptors.request.use((config) => {
  if (config.method && config.method.toUpperCase() !== "GET") {
    // crypto.randomUUID() is available in browser and Node 16+ — no import needed
    ;(config.headers as Record<string, string>)["Idempotency-Key"] ??=
      crypto.randomUUID()
  }
  return config
})

// ─── Response interceptor — error normalisation ───────────────────────────────

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string }>) => {
    const message =
      error.response?.data?.message ?? error.message ?? "Unknown error"
    return Promise.reject(new ApiError(message, error.response?.status))
  }
)
