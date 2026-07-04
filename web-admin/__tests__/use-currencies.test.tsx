/**
 * useAddCurrency / useUpdateCurrency hook tests (runtime "Add currency").
 *
 * Both mutate through the typed `@/lib/api/currencies` clients (mocked — no server)
 * and, on success, invalidate the admin catalog query so the Currency-catalog screen
 * re-resolves with the new/updated row. Adding or toggling a custom fiat moves no
 * money (§3.1). Invalidation is asserted against a real QueryClient's spy.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { AdminCustomFiat } from "@handshake-agent/contracts"

import { useAddCurrency, useUpdateCurrency } from "@/lib/query/hooks"

vi.mock("@/lib/api/currencies", () => ({
  addCurrency: vi.fn(),
  updateCurrency: vi.fn(),
}))

import { addCurrency, updateCurrency } from "@/lib/api/currencies"

const mockAdd = vi.mocked(addCurrency)
const mockUpdate = vi.mocked(updateCurrency)

const FIAT: AdminCustomFiat = {
  code: "KES",
  displayName: "Kenyan Shilling",
  symbol: "KSh",
  decimals: 2,
  enabled: false,
  createdAt: "2026-07-03T00:00:00.000Z",
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(client, "invalidateQueries")
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { wrapper, invalidate }
}

beforeEach(() => {
  mockAdd.mockReset()
  mockAdd.mockResolvedValue(FIAT)
  mockUpdate.mockReset()
  mockUpdate.mockResolvedValue({ ...FIAT, enabled: true })
})

describe("useAddCurrency", () => {
  it("posts the input and invalidates the admin catalog on success", async () => {
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useAddCurrency(), { wrapper })

    const res = await result.current.mutateAsync({
      code: "KES",
      displayName: "Kenyan Shilling",
      symbol: "KSh",
      decimals: 2,
    })

    expect(mockAdd).toHaveBeenCalledWith({
      code: "KES",
      displayName: "Kenyan Shilling",
      symbol: "KSh",
      decimals: 2,
    })
    expect(res).toEqual(FIAT)
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["admin", "config", "catalog"],
      })
    )
  })
})

describe("useUpdateCurrency", () => {
  it("patches (code, patch) and invalidates the admin catalog on success", async () => {
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useUpdateCurrency(), { wrapper })

    const res = await result.current.mutateAsync({
      code: "KES",
      patch: { enabled: true },
    })

    expect(mockUpdate).toHaveBeenCalledWith("KES", { enabled: true })
    expect(res.enabled).toBe(true)
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["admin", "config", "catalog"],
      })
    )
  })
})
