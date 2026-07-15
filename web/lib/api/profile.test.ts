import { beforeEach, describe, expect, it, vi } from "vitest"
import type { UpdateProfileRequest } from "@handshake-agent/contracts"

// Mock the axios instance so no real HTTP happens.
const get = vi.fn()
const post = vi.fn()
const patch = vi.fn()
const del = vi.fn()
vi.mock("./client", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}))

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
} from "./profile"

const profileResponse = {
  email: "user@example.com",
  fullName: "Ada Tester",
  phone: "+2348012345678",
  kycStatus: "verified",
  kycTier: "tier_1",
  fiatCurrency: "NGN",
  limits: null,
}

const session = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  channel: "web",
  userAgent: "Mozilla/5.0",
  createdAt: "2026-07-01T10:00:00.000Z",
  lastUsedAt: "2026-07-08T09:00:00.000Z",
  expiresAt: "2026-08-01T10:00:00.000Z",
  isCurrent: true,
}

const patItem = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  label: "Claude",
  scopes: ["read", "chat:propose"],
  createdAt: "2026-07-08T10:00:00.000Z",
  lastUsedAt: null,
  expiresAt: null,
}

describe("profile api client", () => {
  beforeEach(() => {
    get.mockReset()
    post.mockReset()
    patch.mockReset()
    del.mockReset()
  })

  it("updateProfile PATCHes the validated body and parses the response", async () => {
    patch.mockResolvedValue({ data: profileResponse })

    const result = await updateProfile({ fiatCurrency: "NGN" })

    expect(patch).toHaveBeenCalledWith("/profile", { fiatCurrency: "NGN" })
    expect(result.email).toBe("user@example.com")
  })

  it("updateProfile rejects an empty body before sending", async () => {
    await expect(updateProfile({})).rejects.toThrow()
    expect(patch).not.toHaveBeenCalled()
  })

  it("updateProfile rejects KYC-owned fields before sending (strict)", async () => {
    await expect(
      updateProfile({ fullName: "Eve" } as unknown as UpdateProfileRequest)
    ).rejects.toThrow()
    expect(patch).not.toHaveBeenCalled()
  })

  it("changePin POSTs the validated body to /profile/pin/change", async () => {
    post.mockResolvedValue({ status: 204 })

    await changePin({ currentPin: "1234", newPin: "2468" })

    expect(post).toHaveBeenCalledWith("/profile/pin/change", {
      currentPin: "1234",
      newPin: "2468",
    })
  })

  it("changePin rejects a weak new PIN before sending", async () => {
    await expect(
      changePin({ currentPin: "1234", newPin: "1111" })
    ).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })

  it("listProfileSessions GETs and parses the session list", async () => {
    get.mockResolvedValue({ data: { sessions: [session] } })

    const result = await listProfileSessions()

    expect(get).toHaveBeenCalledWith("/profile/sessions")
    expect(result.sessions[0].isCurrent).toBe(true)
  })

  it("revokeProfileSession DELETEs /profile/sessions/:id", async () => {
    del.mockResolvedValue({ status: 204 })

    await revokeProfileSession(session.id)

    expect(del).toHaveBeenCalledWith(`/profile/sessions/${session.id}`)
  })

  it("listPats GETs and parses the masked token list", async () => {
    get.mockResolvedValue({ data: { tokens: [patItem] } })

    const result = await listPats()

    expect(get).toHaveBeenCalledWith("/profile/tokens")
    expect(result.tokens[0].label).toBe("Claude")
  })

  it("createPat POSTs the validated body and parses the once-only token", async () => {
    post.mockResolvedValue({
      data: {
        id: patItem.id,
        label: "Claude",
        scopes: ["read"],
        token: `hsk_pat_${"a".repeat(64)}`,
        createdAt: "2026-07-08T10:00:00.000Z",
        expiresAt: null,
      },
    })

    const result = await createPat({
      label: "Claude",
      pin: "1234",
      scopes: ["read"],
    })

    expect(post).toHaveBeenCalledWith("/profile/tokens", {
      label: "Claude",
      pin: "1234",
      scopes: ["read"],
    })
    expect(result.token.startsWith("hsk_pat_")).toBe(true)
  })

  it("createPat rejects an empty label before sending", async () => {
    await expect(
      createPat({ label: "", pin: "1234", scopes: ["read"] })
    ).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })

  it("revokePat DELETEs /profile/tokens/:id", async () => {
    del.mockResolvedValue({ status: 204 })

    await revokePat(patItem.id)

    expect(del).toHaveBeenCalledWith(`/profile/tokens/${patItem.id}`)
  })

  it("getPublicNicknames GETs and parses the nickname list", async () => {
    get.mockResolvedValue({
      data: {
        nicknames: [
          { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", alias: "adaonly" },
        ],
      },
    })

    const result = await getPublicNicknames()

    expect(get).toHaveBeenCalledWith("/profile/public-nicknames")
    expect(result.nicknames[0].alias).toBe("adaonly")
  })

  it("createPublicNickname POSTs the validated body and parses the response", async () => {
    post.mockResolvedValue({
      data: { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", alias: "adaonly" },
    })

    const result = await createPublicNickname({ alias: "adaonly" })

    expect(post).toHaveBeenCalledWith("/profile/public-nicknames", {
      alias: "adaonly",
    })
    expect(result.alias).toBe("adaonly")
  })

  it("createPublicNickname rejects a malformed alias before sending", async () => {
    await expect(createPublicNickname({ alias: "AB" })).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })

  it("deletePublicNickname DELETEs /profile/public-nicknames/:id", async () => {
    del.mockResolvedValue({ status: 204 })

    await deletePublicNickname("cccccccc-cccc-cccc-cccc-cccccccccccc")

    expect(del).toHaveBeenCalledWith(
      "/profile/public-nicknames/cccccccc-cccc-cccc-cccc-cccccccccccc"
    )
  })

  it("changePayId PATCHes the validated body with no response body to parse", async () => {
    patch.mockResolvedValue({ status: 204 })

    await changePayId({ payId: "adaonly" })

    expect(patch).toHaveBeenCalledWith("/profile/payid", { payId: "adaonly" })
  })

  it("changePayId rejects a malformed handle before sending", async () => {
    await expect(changePayId({ payId: "a" })).rejects.toThrow()
    expect(patch).not.toHaveBeenCalled()
  })
})
