/**
 * Unit test for the Phase-9 KYC "needs more info" client. Asserts the right
 * route + verb, and that the reason body is parsed before the request fires
 * (§3.3 / §8). The single Axios instance is mocked — no live server.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

import { api } from "./client"
import { requestKycInfo } from "./kyc"

vi.mock("./client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

const mockApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("requestKycInfo", () => {
  it("POSTs the parsed reason body to /admin/kyc/:userId/request-info", async () => {
    mockApi.post.mockResolvedValue({ data: undefined })

    await requestKycInfo("u1", "Selfie is blurry — please re-upload")

    expect(mockApi.post).toHaveBeenCalledWith(
      "/admin/kyc/u1/request-info",
      { reason: "Selfie is blurry — please re-upload" }
    )
  })

  it("rejects a blank reason before the request fires", async () => {
    await expect(requestKycInfo("u1", "")).rejects.toThrow()
    expect(mockApi.post).not.toHaveBeenCalled()
  })
})
