import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const updateProfile = vi.fn()
const changePin = vi.fn()
const listProfileSessions = vi.fn()
const revokeProfileSession = vi.fn()
const listPats = vi.fn()
const createPat = vi.fn()
const revokePat = vi.fn()
const getPublicNicknames = vi.fn()
const createPublicNickname = vi.fn()
const deletePublicNickname = vi.fn()
const changePayId = vi.fn()
vi.mock("@/lib/api/profile", () => ({
  updateProfile: (...a: unknown[]) => updateProfile(...a),
  changePin: (...a: unknown[]) => changePin(...a),
  listProfileSessions: (...a: unknown[]) => listProfileSessions(...a),
  revokeProfileSession: (...a: unknown[]) => revokeProfileSession(...a),
  listPats: (...a: unknown[]) => listPats(...a),
  createPat: (...a: unknown[]) => createPat(...a),
  revokePat: (...a: unknown[]) => revokePat(...a),
  getPublicNicknames: (...a: unknown[]) => getPublicNicknames(...a),
  createPublicNickname: (...a: unknown[]) => createPublicNickname(...a),
  deletePublicNickname: (...a: unknown[]) => deletePublicNickname(...a),
  changePayId: (...a: unknown[]) => changePayId(...a),
}))

// The list queries gate on an access token the way useProfile does.
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: (selector: (s: { accessToken: string }) => unknown) =>
    selector({ accessToken: "token" }),
}))

import {
  useChangePayId,
  useChangePin,
  useCreatePat,
  useCreatePublicNickname,
  useDeletePublicNickname,
  usePats,
  useProfileSessions,
  usePublicNicknames,
  useRevokePat,
  useRevokeSession,
  useUpdateProfile,
} from "./profile"
import { qk } from "./keys"

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe("profile query hooks", () => {
  beforeEach(() => {
    updateProfile.mockReset()
    changePin.mockReset()
    listProfileSessions.mockReset()
    revokeProfileSession.mockReset()
    listPats.mockReset()
    createPat.mockReset()
    revokePat.mockReset()
    getPublicNicknames.mockReset()
    createPublicNickname.mockReset()
    deletePublicNickname.mockReset()
    changePayId.mockReset()
  })

  it("useUpdateProfile writes the fresh profile into the cache", async () => {
    const fresh = { email: "u@e.com", fiatCurrency: "GHS" }
    updateProfile.mockResolvedValue(fresh)
    const { client, wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateProfile(), { wrapper })

    await result.current.mutateAsync({ fiatCurrency: "GHS" })

    expect(updateProfile).toHaveBeenCalledWith({ fiatCurrency: "GHS" })
    expect(client.getQueryData(qk.profile)).toEqual(fresh)
  })

  it("useChangePin calls the changePin client", async () => {
    changePin.mockResolvedValue(undefined)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useChangePin(), { wrapper })

    await result.current.mutateAsync({ currentPin: "1234", newPin: "2468" })

    expect(changePin).toHaveBeenCalledWith({
      currentPin: "1234",
      newPin: "2468",
    })
  })

  it("useProfileSessions loads the session list", async () => {
    listProfileSessions.mockResolvedValue({ sessions: [{ id: "s1" }] })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useProfileSessions(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.sessions).toHaveLength(1)
  })

  it("useRevokeSession revokes by id and invalidates the session list", async () => {
    revokeProfileSession.mockResolvedValue(undefined)
    const { client, wrapper } = makeWrapper()
    const spy = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useRevokeSession(), { wrapper })

    await result.current.mutateAsync("s1")

    expect(revokeProfileSession).toHaveBeenCalledWith("s1")
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.profileSessions })
  })

  it("usePats loads the token list", async () => {
    listPats.mockResolvedValue({ tokens: [{ id: "t1" }] })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => usePats(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.tokens).toHaveLength(1)
  })

  it("useCreatePat invalidates the token list on success", async () => {
    createPat.mockResolvedValue({ id: "t1", token: "hsk_pat_x" })
    const { client, wrapper } = makeWrapper()
    const spy = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useCreatePat(), { wrapper })

    await result.current.mutateAsync({
      label: "Claude",
      pin: "1234",
      scopes: ["read"],
    })

    expect(createPat).toHaveBeenCalledWith({
      label: "Claude",
      pin: "1234",
      scopes: ["read"],
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.pats })
  })

  it("useRevokePat invalidates the token list on success", async () => {
    revokePat.mockResolvedValue(undefined)
    const { client, wrapper } = makeWrapper()
    const spy = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useRevokePat(), { wrapper })

    await result.current.mutateAsync("t1")

    expect(revokePat).toHaveBeenCalledWith("t1")
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.pats })
  })

  it("usePublicNicknames loads the nickname list", async () => {
    getPublicNicknames.mockResolvedValue({ nicknames: [{ id: "n1" }] })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => usePublicNicknames(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.nicknames).toHaveLength(1)
  })

  it("useCreatePublicNickname invalidates the nickname list on success", async () => {
    createPublicNickname.mockResolvedValue({ id: "n1", alias: "adaonly" })
    const { client, wrapper } = makeWrapper()
    const spy = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useCreatePublicNickname(), { wrapper })

    await result.current.mutateAsync({ alias: "adaonly" })

    expect(createPublicNickname).toHaveBeenCalledWith({ alias: "adaonly" })
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.publicNicknames })
  })

  it("useDeletePublicNickname invalidates the nickname list on success", async () => {
    deletePublicNickname.mockResolvedValue(undefined)
    const { client, wrapper } = makeWrapper()
    const spy = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useDeletePublicNickname(), { wrapper })

    await result.current.mutateAsync("n1")

    expect(deletePublicNickname).toHaveBeenCalledWith("n1")
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.publicNicknames })
  })

  it("useChangePayId invalidates both the profile and me caches on success", async () => {
    changePayId.mockResolvedValue(undefined)
    const { client, wrapper } = makeWrapper()
    const spy = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useChangePayId(), { wrapper })

    await result.current.mutateAsync({ payId: "adaonly" })

    expect(changePayId).toHaveBeenCalledWith({ payId: "adaonly" })
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.profile })
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.me })
  })
})
