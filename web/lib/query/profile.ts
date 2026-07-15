/**
 * TanStack Query hooks for the Settings surface: profile edit, PIN change,
 * session management, and personal access tokens (connected agents / MCP).
 *
 * Wraps lib/api/profile so components never touch the api client directly.
 * List queries gate on an in-memory access token like useProfile does.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  ChangePinRequest,
  ClaimPayId,
  CreatePatRequest,
  CreatePublicNickname,
  UpdateProfileRequest,
} from "@handshake-agent/contracts"
import {
  changePayId,
  changePin,
  createPat,
  createPublicNickname,
  deletePublicNickname,
  getPublicNicknames,
  listPats,
  listProfileSessions,
  revokePat,
  revokeProfileSession,
  updateProfile,
} from "@/lib/api/profile"
import { useAuthStore } from "@/lib/store/auth-store"
import { qk } from "./keys"

/** Sessions/tokens change only through this surface — 30 s is plenty fresh. */
const STALE_TIME_MS = 30_000

/** PATCH /profile — the response is the fresh profile; write it straight into the cache. */
export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) => updateProfile(body),
    onSuccess: (fresh) => {
      queryClient.setQueryData(qk.profile, fresh)
    },
  })
}

/** POST /profile/pin/change — errors surface via lib/settings/pin-error mapping. */
export function useChangePin() {
  return useMutation({
    mutationFn: (body: ChangePinRequest) => changePin(body),
  })
}

export function useProfileSessions() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: qk.profileSessions,
    queryFn: listProfileSessions,
    enabled: !!accessToken,
    staleTime: STALE_TIME_MS,
  })
}

export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => revokeProfileSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.profileSessions })
    },
  })
}

export function usePats() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: qk.pats,
    queryFn: listPats,
    enabled: !!accessToken,
    staleTime: STALE_TIME_MS,
  })
}

export function useCreatePat() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreatePatRequest) => createPat(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.pats })
    },
  })
}

export function useRevokePat() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => revokePat(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.pats })
    },
  })
}

/** GET /profile/public-nicknames — the user's own @-mention aliases (Spec 2). */
export function usePublicNicknames() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: qk.publicNicknames,
    queryFn: getPublicNicknames,
    enabled: !!accessToken,
    staleTime: STALE_TIME_MS,
  })
}

export function useCreatePublicNickname() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreatePublicNickname) => createPublicNickname(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.publicNicknames })
    },
  })
}

export function useDeletePublicNickname() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deletePublicNickname(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.publicNicknames })
    },
  })
}

/**
 * PATCH /profile/payid — one-time PayID change. Invalidates BOTH `profile`
 * (GET /profile) and `me` (GET /auth/me) — the fresh `@handle` is surfaced
 * from either depending on which the caller reads (root CLAUDE.md §5 —
 * TanStack Query owns all server state, so a successful mutation always
 * refetches rather than leaving the old handle cached).
 */
export function useChangePayId() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ClaimPayId) => changePayId(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.profile })
      void queryClient.invalidateQueries({ queryKey: qk.me })
    },
  })
}
