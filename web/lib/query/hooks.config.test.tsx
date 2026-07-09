/**
 * TDD tests for useConfig hook.
 * Tests are written BEFORE the implementation — red → green → refactor.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, afterEach } from "vitest"
import type { PublicConfigResponse } from "@handshake-agent/contracts"
import { gateway } from "@/lib/api/gateway"
import { formatFiat, hydrateFiatDisplay } from "@/lib/format"
import { useConfig } from "./hooks"

// ─── Fixture ─────────────────────────────────────────────────────────────────

const mockConfig: PublicConfigResponse = {
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
  capabilities: { "crypto.buy": true, "crypto.sell": true, send: true },
}

// ─── Wrapper factory ──────────────────────────────────────────────────────────

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns parsed PublicConfigResponse from gateway.getConfig", async () => {
    vi.spyOn(gateway, "getConfig").mockResolvedValue(mockConfig)
    const { wrapper } = makeWrapper()

    const { result } = renderHook(() => useConfig(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.fiats[0].symbol).toBe("₦")
  })

  it("exposes fiat code from the response", async () => {
    vi.spyOn(gateway, "getConfig").mockResolvedValue(mockConfig)
    const { wrapper } = makeWrapper()

    const { result } = renderHook(() => useConfig(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.fiats[0].code).toBe("NGN")
  })

  it("exposes assets array from the response", async () => {
    vi.spyOn(gateway, "getConfig").mockResolvedValue(mockConfig)
    const { wrapper } = makeWrapper()

    const { result } = renderHook(() => useConfig(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.assets[0].symbol).toBe("USDT")
    expect(result.current.data?.assets[0].networks).toContain("tron")
  })

  it("exposes networks array from the response", async () => {
    vi.spyOn(gateway, "getConfig").mockResolvedValue(mockConfig)
    const { wrapper } = makeWrapper()

    const { result } = renderHook(() => useConfig(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.networks[0].id).toBe("tron")
  })

  it("exposes capabilities map from the response", async () => {
    vi.spyOn(gateway, "getConfig").mockResolvedValue(mockConfig)
    const { wrapper } = makeWrapper()

    const { result } = renderHook(() => useConfig(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.capabilities["crypto.buy"]).toBe(true)
  })

  it("hydrates the fiat display registry so formatFiat uses /config symbols + decimals", async () => {
    // GHS is configured with a non-default symbol and 0 decimals — after the
    // config loads, chat-card formatting must use these, not the static map.
    vi.spyOn(gateway, "getConfig").mockResolvedValue({
      ...mockConfig,
      fiats: [
        ...mockConfig.fiats,
        { code: "GHS", displayName: "Ghanaian Cedi", symbol: "₵", decimals: 0 },
      ],
    })
    const { wrapper } = makeWrapper()

    const { result } = renderHook(() => useConfig(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(formatFiat("20000", "GHS")).toBe("₵20,000")
    // Reset the module-level registry so other test files see the fallback.
    hydrateFiatDisplay([])
  })
})
