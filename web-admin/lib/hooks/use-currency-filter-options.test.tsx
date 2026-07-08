/**
 * useCurrencyFilterOptions — currency filter options derive from the LIVE admin
 * catalog read (runtime-added fiats appear; the ledger variant appends crypto
 * assets), with the offline fiat set as the pre-resolve fallback. The catalog
 * hook also side-hydrates the module-level fiat display registry so `isFiat`/
 * `formatFiat` classify runtime fiats correctly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { AdminCatalogView } from "@handshake-agent/contracts"

vi.mock("@/lib/api/catalog", () => ({ getAdminCatalog: vi.fn() }))

import { getAdminCatalog } from "@/lib/api/catalog"
import { FIAT_SYMBOLS, hydrateFiatDisplay, isFiat } from "@/lib/format"

import { useCurrencyFilterOptions } from "./use-currency-filter-options"

const mockCatalog = vi.mocked(getAdminCatalog)

const CATALOG: AdminCatalogView = {
  assets: [
    {
      symbol: "USDT",
      displayName: "Tether USD",
      kind: "crypto",
      decimals: 6,
      networks: ["TRON"],
      live: true,
      logoUrl: null,
    },
    {
      symbol: "TRX",
      displayName: "Tron",
      kind: "crypto",
      decimals: 6,
      networks: ["TRON"],
      live: true,
      logoUrl: null,
    },
  ],
  fiats: [
    {
      code: "NGN",
      symbol: "₦",
      displayName: "Nigerian Naira",
      decimals: 2,
      live: true,
      custom: false,
    },
    {
      code: "XOF",
      symbol: "CFA",
      displayName: "West African CFA franc",
      decimals: 0,
      live: false,
      custom: true,
    },
  ],
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  mockCatalog.mockReset().mockResolvedValue(CATALOG)
})

afterEach(() => hydrateFiatDisplay([]))

describe("useCurrencyFilterOptions", () => {
  it("falls back to the offline fiat set before the catalog resolves", () => {
    mockCatalog.mockReturnValue(new Promise(() => undefined)) // never resolves
    const { result } = renderHook(() => useCurrencyFilterOptions(), { wrapper })
    expect(result.current[0]).toEqual({ value: "", label: "All currencies" })
    expect(result.current.map((o) => o.value)).toEqual([
      "",
      ...Object.keys(FIAT_SYMBOLS),
    ])
  })

  it("derives fiat options (incl. runtime-added) from the catalog read", async () => {
    const { result } = renderHook(() => useCurrencyFilterOptions(), { wrapper })
    await waitFor(() =>
      expect(result.current.map((o) => o.value)).toEqual(["", "NGN", "XOF"])
    )
    expect(result.current[1]).toEqual({ value: "NGN", label: "NGN" })
  })

  it("appends crypto assets for the ledger's mixed currency axis", async () => {
    const { result } = renderHook(() => useCurrencyFilterOptions(true), {
      wrapper,
    })
    await waitFor(() =>
      expect(result.current.map((o) => o.value)).toEqual([
        "",
        "NGN",
        "XOF",
        "USDT",
        "TRX",
      ])
    )
  })

  it("side-hydrates the fiat display registry (runtime fiat classified as fiat)", async () => {
    expect(isFiat("XOF")).toBe(false)
    renderHook(() => useCurrencyFilterOptions(), { wrapper })
    await waitFor(() => expect(isFiat("XOF")).toBe(true))
  })
})
