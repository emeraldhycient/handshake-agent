import { describe, expect, it } from "vitest"
import { api, ApiError } from "./client"

/**
 * The DomainExceptionFilter echoes a stable `code` (PIN_INVALID, PIN_LOCKED, …)
 * in error bodies. The response interceptor must thread it onto ApiError so
 * dialogs can branch on the cause (wrong PIN vs lockout) instead of parsing
 * message strings.
 */
function rejectedHandler(): (err: unknown) => Promise<unknown> {
  // axios stores registered interceptor pairs on `.handlers` (stable in 1.x).
  const { handlers } = api.interceptors.response as unknown as {
    handlers: Array<{ rejected?: (err: unknown) => Promise<unknown> }>
  }
  const rejected = handlers[0]?.rejected
  if (!rejected) throw new Error("response interceptor not registered")
  return rejected
}

describe("api client error normalisation", () => {
  it("threads the server body's `code` onto ApiError", async () => {
    const axiosLikeError = {
      config: { url: "/profile/pin/change" },
      response: {
        status: 401,
        data: { message: "Authorization failed.", code: "PIN_INVALID" },
      },
      message: "Request failed with status code 401",
    }

    await expect(rejectedHandler()(axiosLikeError)).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "PIN_INVALID",
      message: "Authorization failed.",
    })
  })

  it("leaves code undefined when the body has none", async () => {
    const axiosLikeError = {
      config: { url: "/profile" },
      response: { status: 500, data: { message: "Something went wrong." } },
      message: "Request failed with status code 500",
    }

    const rejection = await rejectedHandler()(axiosLikeError).catch((e) => e)
    expect(rejection).toBeInstanceOf(ApiError)
    expect((rejection as ApiError).code).toBeUndefined()
  })
})
