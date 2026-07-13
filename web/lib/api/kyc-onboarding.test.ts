/**
 * Onboarding KYC API client — submitName (POST /profile/name) and
 * fetchSumsubToken (POST /kyc/sumsub/token).
 *
 * Mirrors the kyc.ts / auth.ts style: parse the request body through the
 * contracts Zod schema before sending, parse the response after. Mocks the
 * single axios instance (`api`) so no real HTTP happens.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { api } from "./client"
import { fetchSumsubToken, submitName } from "./kyc-onboarding"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("submitName", () => {
  it("POSTs firstName+lastName to /profile/name and returns the parsed response", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: { firstName: "Ada", lastName: "Tester" },
    } as never)

    const res = await submitName({ firstName: "Ada", lastName: "Tester" })

    expect(post).toHaveBeenCalledWith("/profile/name", {
      firstName: "Ada",
      lastName: "Tester",
    })
    expect(res).toEqual({ firstName: "Ada", lastName: "Tester" })
  })

  it("rejects an empty firstName before sending (UX parse gate)", async () => {
    const post = vi.spyOn(api, "post")

    await expect(
      submitName({ firstName: "", lastName: "Tester" })
    ).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })

  it("rejects a response missing lastName", async () => {
    vi.spyOn(api, "post").mockResolvedValue({
      data: { firstName: "Ada" },
    } as never)

    await expect(
      submitName({ firstName: "Ada", lastName: "Tester" })
    ).rejects.toThrow()
  })
})

describe("fetchSumsubToken", () => {
  it("POSTs the level to /kyc/sumsub/token and returns the parsed token", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: {
        token: "sumsub-sdk-token",
        userId: "00000000-0000-0000-0000-000000000001",
      },
    } as never)

    const res = await fetchSumsubToken("tier_2")

    expect(post).toHaveBeenCalledWith("/kyc/sumsub/token", { level: "tier_2" })
    expect(res.token).toBe("sumsub-sdk-token")
    expect(res.userId).toBe("00000000-0000-0000-0000-000000000001")
  })

  it("rejects an invalid level before sending (UX parse gate)", async () => {
    const post = vi.spyOn(api, "post")

    // @ts-expect-error — deliberately passing an invalid level to assert the guard
    await expect(fetchSumsubToken("tier_9")).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })

  it("rejects a response missing the token", async () => {
    vi.spyOn(api, "post").mockResolvedValue({
      data: { userId: "00000000-0000-0000-0000-000000000001" },
    } as never)

    await expect(fetchSumsubToken("tier_3")).rejects.toThrow()
  })
})
