/**
 * Unit tests for the blocked-entry (deny-list) API clients. Each asserts the
 * client hits the right route, parses its input through the request schema
 * before the request fires, and parses the response through the response schema
 * after (§3.3 / §8). The single Axios instance is mocked — no live server.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

import { api } from "./client"
import { listBlocked, addBlocked, supersedeBlocked } from "./blocked"

vi.mock("./client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

const mockApi = vi.mocked(api)

const entry = {
  id: "blk_1",
  kind: "address" as const,
  value: "0xdead",
  reason: "sanctions match",
  addedByAdminId: "adm_1",
  createdAt: "2026-07-03T00:00:00.000Z",
  supersededAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("listBlocked", () => {
  it("GETs /admin/blocked and parses the list response", async () => {
    mockApi.get.mockResolvedValue({ data: { items: [entry] } })

    const result = await listBlocked()

    expect(mockApi.get).toHaveBeenCalledWith("/admin/blocked")
    expect(result.items).toHaveLength(1)
    expect(result.items[0].kind).toBe("address")
  })

  it("throws when the response fails the schema", async () => {
    mockApi.get.mockResolvedValue({ data: { items: [{ id: "blk_1" }] } })
    await expect(listBlocked()).rejects.toThrow()
  })
})

describe("addBlocked", () => {
  it("POSTs the parsed body to /admin/blocked and parses the created entry", async () => {
    mockApi.post.mockResolvedValue({ data: entry })

    const result = await addBlocked({
      kind: "address",
      value: "0xdead",
      reason: "sanctions match",
    })

    expect(mockApi.post).toHaveBeenCalledWith("/admin/blocked", {
      kind: "address",
      value: "0xdead",
      reason: "sanctions match",
    })
    expect(result.id).toBe("blk_1")
  })

  it("rejects an invalid input before the request fires", async () => {
    await expect(
      // reason too short (min 3) — schema must reject pre-flight
      addBlocked({ kind: "address", value: "0xdead", reason: "x" })
    ).rejects.toThrow()
    expect(mockApi.post).not.toHaveBeenCalled()
  })
})

describe("supersedeBlocked", () => {
  it("POSTs the reason body to /admin/blocked/:id/supersede", async () => {
    mockApi.post.mockResolvedValue({ data: { ...entry, supersededAt: "2026-07-03T01:00:00.000Z" } })

    await supersedeBlocked("blk_1", "false positive")

    expect(mockApi.post).toHaveBeenCalledWith("/admin/blocked/blk_1/supersede", {
      reason: "false positive",
    })
  })

  it("rejects a blank reason before the request fires", async () => {
    await expect(supersedeBlocked("blk_1", "")).rejects.toThrow()
    expect(mockApi.post).not.toHaveBeenCalled()
  })
})
