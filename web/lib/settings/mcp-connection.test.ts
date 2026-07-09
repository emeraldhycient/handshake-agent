import { beforeEach, describe, expect, it, vi } from "vitest"

// Mutable stand-in for the axios instance — only `defaults.baseURL` is read.
const client = vi.hoisted(() => ({
  defaults: { baseURL: "/api" as string | undefined },
}))
vi.mock("@/lib/api/client", () => ({ api: client }))

import { claudeMcpAddCommand, mcpEndpointUrl } from "./mcp-connection"

describe("mcpEndpointUrl", () => {
  beforeEach(() => {
    client.defaults.baseURL = "/api"
  })

  it("appends /mcp to an absolute API base URL", () => {
    client.defaults.baseURL = "https://api.handshake.example/"
    expect(mcpEndpointUrl()).toBe("https://api.handshake.example/mcp")
  })

  it("resolves a relative base against the page origin", () => {
    client.defaults.baseURL = "/api"
    expect(mcpEndpointUrl()).toBe(`${window.location.origin}/api/mcp`)
  })
})

describe("claudeMcpAddCommand", () => {
  it("builds the claude mcp add snippet with the bearer header", () => {
    const cmd = claudeMcpAddCommand("https://api.example.com/mcp")
    expect(cmd).toBe(
      'claude mcp add --transport http handshake https://api.example.com/mcp --header "Authorization: Bearer <your token>"'
    )
  })

  it("inlines a concrete token when given one", () => {
    const cmd = claudeMcpAddCommand("https://api.example.com/mcp", "hsk_pat_abc")
    expect(cmd).toContain("Bearer hsk_pat_abc")
  })
})
