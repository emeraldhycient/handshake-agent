/**
 * Unit test for the Phase-9 admin beneficiary-removal client. Asserts the right
 * route + verb (DELETE), and that the reason body rides on axios `{ data }` and
 * is parsed before the request fires (§3.3 / §8). The single Axios instance is
 * mocked — no live server.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

import { api } from "./client"
import { removeBeneficiary } from "./beneficiaries"

vi.mock("./client", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

const mockApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("removeBeneficiary", () => {
  it("DELETEs /admin/beneficiaries/:id with the reason body via { data }", async () => {
    mockApi.delete.mockResolvedValue({ data: undefined })

    await removeBeneficiary("b1", "flagged destination")

    expect(mockApi.delete).toHaveBeenCalledWith("/admin/beneficiaries/b1", {
      data: { reason: "flagged destination" },
    })
  })

  it("rejects a blank reason before the request fires", async () => {
    await expect(removeBeneficiary("b1", "")).rejects.toThrow()
    expect(mockApi.delete).not.toHaveBeenCalled()
  })
})
