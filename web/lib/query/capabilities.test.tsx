import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, afterEach } from "vitest"
import type { PublicConfigResponse } from "@handshake-agent/contracts"
import { gateway } from "@/lib/api/gateway"
import { useCapabilities } from "./capabilities"

const base: Omit<PublicConfigResponse, "capabilities"> = {
  fiats: [
    { code: "NGN", displayName: "Nigerian Naira", symbol: "₦", decimals: 2 },
  ],
  assets: [
    {
      symbol: "USDT",
      displayName: "Tether USD",
      decimals: 6,
      networks: ["tron"],
    },
  ],
  networks: [{ id: "tron", displayName: "TRON (TRC-20)" }],
}
const makeConfig = (
  capabilities: Record<string, boolean>
): PublicConfigResponse => ({ ...base, capabilities })

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { wrapper }
}

describe("useCapabilities", () => {
  afterEach(() => vi.restoreAllMocks())

  it("disables swap + tickets when the flags are absent or false", async () => {
    vi.spyOn(gateway, "getConfig").mockResolvedValue(
      makeConfig({ "crypto.buy": true, "crypto.swap": false })
    )
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useCapabilities(), { wrapper })
    await waitFor(() => expect(result.current.has("crypto.buy")).toBe(true))
    expect(result.current.canSwap).toBe(false)
    expect(result.current.canTickets).toBe(false)
  })

  it("enables swap + tickets when their flags are true", async () => {
    vi.spyOn(gateway, "getConfig").mockResolvedValue(
      makeConfig({ "crypto.swap": true, ticketing: true })
    )
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useCapabilities(), { wrapper })
    await waitFor(() => expect(result.current.canSwap).toBe(true))
    expect(result.current.canTickets).toBe(true)
  })
})
