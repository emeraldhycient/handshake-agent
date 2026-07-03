/**
 * Unit tests for the runtime "Add currency" (custom-fiat) API clients. Each asserts
 * the client hits the right route, parses its input through the request schema before
 * the request fires (§3.3: never trust the FE as the only gate; the request is
 * rejected pre-flight on invalid input), and parses the response through the response
 * schema after (§8). The single Axios instance is mocked — no live server. None of
 * these move money (§3.1); add/enable/disable is step-up-gated + audited server-side.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

import { api } from "./client"
import { listCustomFiats, addCurrency, updateCurrency } from "./currencies"

vi.mock("./client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const mockApi = vi.mocked(api)

const fiat = {
  code: "KES",
  displayName: "Kenyan Shilling",
  symbol: "KSh",
  decimals: 2,
  enabled: false,
  createdAt: "2026-07-03T00:00:00.000Z",
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("listCustomFiats", () => {
  it("GETs /admin/config/currencies and parses the list response", async () => {
    mockApi.get.mockResolvedValue({ data: { items: [fiat] } })

    const result = await listCustomFiats()

    expect(mockApi.get).toHaveBeenCalledWith("/admin/config/currencies")
    expect(result.items).toHaveLength(1)
    expect(result.items[0].code).toBe("KES")
  })

  it("throws when the response fails the schema", async () => {
    mockApi.get.mockResolvedValue({ data: { items: [{ code: "KES" }] } })
    await expect(listCustomFiats()).rejects.toThrow()
  })
})

describe("addCurrency", () => {
  it("POSTs the parsed body to /admin/config/currencies and parses the created fiat", async () => {
    mockApi.post.mockResolvedValue({ data: fiat })

    const result = await addCurrency({
      code: "KES",
      displayName: "Kenyan Shilling",
      symbol: "KSh",
      decimals: 2,
    })

    expect(mockApi.post).toHaveBeenCalledWith("/admin/config/currencies", {
      code: "KES",
      displayName: "Kenyan Shilling",
      symbol: "KSh",
      decimals: 2,
    })
    expect(result.code).toBe("KES")
    // Created disabled — the enabled-needs-pricing invariant is fail-closed.
    expect(result.enabled).toBe(false)
  })

  it("rejects an invalid code before the request fires", async () => {
    await expect(
      // `code` must be a 3-letter uppercase code — schema rejects pre-flight.
      addCurrency({
        code: "kesh",
        displayName: "Kenyan Shilling",
        symbol: "KSh",
        decimals: 2,
      })
    ).rejects.toThrow()
    expect(mockApi.post).not.toHaveBeenCalled()
  })

  it("rejects out-of-range decimals before the request fires", async () => {
    await expect(
      addCurrency({
        code: "KES",
        displayName: "Kenyan Shilling",
        symbol: "KSh",
        decimals: 9,
      })
    ).rejects.toThrow()
    expect(mockApi.post).not.toHaveBeenCalled()
  })
})

describe("updateCurrency", () => {
  it("PATCHes the parsed patch to /admin/config/currencies/:code and parses the fiat", async () => {
    mockApi.patch.mockResolvedValue({ data: { ...fiat, enabled: true } })

    const result = await updateCurrency("KES", { enabled: true })

    expect(mockApi.patch).toHaveBeenCalledWith(
      "/admin/config/currencies/KES",
      { enabled: true }
    )
    expect(result.enabled).toBe(true)
  })

  it("URL-encodes the code segment", async () => {
    mockApi.patch.mockResolvedValue({ data: fiat })
    await updateCurrency("K S", { enabled: false })
    expect(mockApi.patch).toHaveBeenCalledWith(
      "/admin/config/currencies/K%20S",
      { enabled: false }
    )
  })

  it("rejects an empty patch before the request fires", async () => {
    // The update schema requires at least one field.
    await expect(updateCurrency("KES", {})).rejects.toThrow()
    expect(mockApi.patch).not.toHaveBeenCalled()
  })
})
