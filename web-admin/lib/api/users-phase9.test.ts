/**
 * Unit tests for the Phase-9 end-user API clients (notes / resend-verification /
 * force-re-KYC / session revocation). Each asserts the right route + verb, that
 * the input is parsed before the request fires, and the response after (§3.3 /
 * §8). DELETE routes carry their reason body via axios `{ data }`. The single
 * Axios instance is mocked — no live server.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

import { api } from "./client"
import {
  createUserNote,
  listUserNotes,
  resendVerification,
  forceReKyc,
  revokeUserSession,
  revokeAllUserSessions,
} from "./users"

vi.mock("./client", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

const mockApi = vi.mocked(api)

const note = {
  id: "note_1",
  body: "Called the user to confirm identity.",
  authorAdminId: "adm_1",
  createdAt: "2026-07-03T00:00:00.000Z",
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("createUserNote", () => {
  it("POSTs the parsed body to /admin/users/:id/notes and parses the created note", async () => {
    mockApi.post.mockResolvedValue({ data: note })

    const result = await createUserNote("u1", { body: "hello" })

    expect(mockApi.post).toHaveBeenCalledWith("/admin/users/u1/notes", {
      body: "hello",
    })
    expect(result.id).toBe("note_1")
  })

  it("rejects an empty note body before the request fires", async () => {
    await expect(createUserNote("u1", { body: "" })).rejects.toThrow()
    expect(mockApi.post).not.toHaveBeenCalled()
  })
})

describe("listUserNotes", () => {
  it("GETs /admin/users/:id/notes and parses the list", async () => {
    mockApi.get.mockResolvedValue({ data: { items: [note] } })

    const result = await listUserNotes("u1")

    expect(mockApi.get).toHaveBeenCalledWith("/admin/users/u1/notes")
    expect(result.items).toHaveLength(1)
  })
})

describe("resendVerification", () => {
  it("POSTs an optional reason body to /admin/users/:id/resend-verification", async () => {
    mockApi.post.mockResolvedValue({ data: undefined })

    await resendVerification("u1", "user asked")

    expect(mockApi.post).toHaveBeenCalledWith(
      "/admin/users/u1/resend-verification",
      { reason: "user asked" }
    )
  })

  it("POSTs an empty body when no reason is given (reason optional)", async () => {
    mockApi.post.mockResolvedValue({ data: undefined })

    await resendVerification("u1")

    expect(mockApi.post).toHaveBeenCalledWith(
      "/admin/users/u1/resend-verification",
      {}
    )
  })
})

describe("forceReKyc", () => {
  it("POSTs the parsed reason body to /admin/users/:id/force-rekyc", async () => {
    mockApi.post.mockResolvedValue({ data: undefined })

    await forceReKyc("u1", "SIM-swap concern")

    expect(mockApi.post).toHaveBeenCalledWith("/admin/users/u1/force-rekyc", {
      reason: "SIM-swap concern",
    })
  })

  it("rejects a blank reason before the request fires", async () => {
    await expect(forceReKyc("u1", "")).rejects.toThrow()
    expect(mockApi.post).not.toHaveBeenCalled()
  })
})

describe("revokeUserSession", () => {
  it("DELETEs /admin/users/:id/sessions/:sessionId with the reason body via { data }", async () => {
    mockApi.delete.mockResolvedValue({ data: undefined })

    await revokeUserSession("u1", "s1", "suspicious login")

    expect(mockApi.delete).toHaveBeenCalledWith("/admin/users/u1/sessions/s1", {
      data: { reason: "suspicious login" },
    })
  })

  it("rejects a blank reason before the request fires", async () => {
    await expect(revokeUserSession("u1", "s1", "")).rejects.toThrow()
    expect(mockApi.delete).not.toHaveBeenCalled()
  })
})

describe("revokeAllUserSessions", () => {
  it("DELETEs /admin/users/:id/sessions with the reason body via { data }", async () => {
    mockApi.delete.mockResolvedValue({ data: undefined })

    await revokeAllUserSessions("u1", "account takeover")

    expect(mockApi.delete).toHaveBeenCalledWith("/admin/users/u1/sessions", {
      data: { reason: "account takeover" },
    })
  })

  it("rejects a blank reason before the request fires", async () => {
    await expect(revokeAllUserSessions("u1", "")).rejects.toThrow()
    expect(mockApi.delete).not.toHaveBeenCalled()
  })
})
