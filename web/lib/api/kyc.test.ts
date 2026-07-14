/**
 * KYC API client tests — submitSetPin (POST /kyc/pin).
 *
 * Sets the transaction PIN pre-KYC (verified-but-PIN-less recovery is a
 * distinct server-side gate; see kyc.controller.ts). Parses the request body
 * through SetPinRequestSchema before sending and the response after. Mocks
 * the single axios instance so no real HTTP happens.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { api } from "./client"
import { submitSetPin } from "./kyc"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("submitSetPin", () => {
  it("POSTs the pin to /kyc/pin and returns the parsed response", async () => {
    const post = vi
      .spyOn(api, "post")
      .mockResolvedValue({ data: { hasPin: true } } as never)

    const res = await submitSetPin("1357")

    expect(post).toHaveBeenCalledWith("/kyc/pin", { pin: "1357" })
    expect(res).toEqual({ hasPin: true })
  })

  it("rejects a weak/invalid pin before sending (UX parse gate)", async () => {
    const post = vi.spyOn(api, "post")

    await expect(submitSetPin("1234")).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })
})
