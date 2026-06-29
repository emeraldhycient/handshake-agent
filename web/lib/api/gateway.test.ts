import { describe, expect, it } from "vitest"
import * as mock from "./mock/index"
import { gateway } from "./gateway"

describe("gateway", () => {
  it("exposes the same method names as the mock", () => {
    const mockMethods = Object.keys(mock)
    for (const method of mockMethods) {
      expect(gateway, `gateway is missing method "${method}"`).toHaveProperty(
        method
      )
    }
  })

  it("uses the mock gateway in tests — getBalances() deep-equals mock.getBalances()", async () => {
    const [fromGateway, fromMock] = await Promise.all([
      gateway.getBalances(),
      mock.getBalances(),
    ])
    expect(fromGateway).toEqual(fromMock)
  })
})
