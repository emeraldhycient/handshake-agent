/**
 * Single Axios instance for the real (non-mock) API.
 *
 * Request interceptors (in order of registration):
 *   1. Idempotency-Key — sets a UUID on every non-GET request.
 *   2. Auth Bearer    — attaches the in-memory access token as Authorization.
 *
 * Response interceptor:
 *   Combined 401-retry + error normalisation. Attempts a silent token refresh
 *   on the first 401 from any non-auth endpoint; on success it re-issues the
 *   original request with the new token. On failure (or for all other errors)
 *   it normalises to ApiError.
 *
 * Components and hooks must never import axios directly — use `api` from here
 * or, better, import `gateway` (which picks mock vs real at build/runtime).
 */

import axios, { type AxiosError, type AxiosRequestConfig } from "axios"
import { defaultAuthStore } from "@/lib/store/auth-store"

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

// ─── Request interceptor 1 — Idempotency-Key ─────────────────────────────────

api.interceptors.request.use((config) => {
  if (config.method && config.method.toUpperCase() !== "GET") {
    // crypto.randomUUID() is available in browser and Node 16+ — no import needed
    ;(config.headers as Record<string, string>)["Idempotency-Key"] ??=
      crypto.randomUUID()
  }
  return config
})

// ─── Request interceptor 2 — Auth Bearer ─────────────────────────────────────

api.interceptors.request.use((config) => {
  const token = defaultAuthStore.getState().accessToken
  if (token) {
    ;(config.headers as Record<string, string>)["Authorization"] =
      `Bearer ${token}`
  }
  return config
})

// ─── Response interceptor — 401 retry + error normalisation ──────────────────
//
// A single combined interceptor keeps the retry logic and normalization in one
// place and avoids chaining issues where a prior interceptor has already
// converted AxiosError → ApiError before the retry logic can inspect status.

type RetryableConfig = AxiosRequestConfig & { _retry?: boolean }

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ message?: string }>) => {
    const config = error.config as RetryableConfig | undefined
    const isAuthEndpoint = config?.url?.includes("/auth/")
    const alreadyRetried = config?._retry === true

    // Attempt silent token refresh only on a first 401 from a non-auth endpoint.
    if (
      error.response?.status === 401 &&
      !isAuthEndpoint &&
      !alreadyRetried &&
      config
    ) {
      config._retry = true
      const { refreshToken } = defaultAuthStore.getState()
      if (refreshToken) {
        try {
          const { data } = await api.post<{
            accessToken: string
            refreshToken: string
          }>("/auth/refresh", { refreshToken })
          defaultAuthStore.getState().setTokens(data.accessToken, data.refreshToken)
          ;(config.headers as Record<string, string>)["Authorization"] =
            `Bearer ${data.accessToken}`
          return api(config)
        } catch {
          // Refresh failed — session is unrecoverable; clear and surface error.
          defaultAuthStore.getState().clear()
          return Promise.reject(
            new ApiError("Session expired. Please log in again.", 401),
          )
        }
      }
    }

    // Normalise all other errors (including 401s where retry was skipped) to ApiError.
    const message =
      error.response?.data?.message ?? error.message ?? "Unknown error"
    return Promise.reject(new ApiError(message, error.response?.status))
  },
)
