import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useBalances, useCreateQuote, useExecuteTransaction } from "./hooks"

// Fresh client per test so the cache never leaks between cases.
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe("query hooks", () => {
  it("useBalances loads", async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBalances(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.total).toBe("≈ ₦72,340")
  })

  it("useCreateQuote returns a quote", async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useCreateQuote(), { wrapper })
    const quote = await result.current.mutateAsync("buy")
    expect(quote.kind).toBe("quote")
    expect(quote.receiveAmt).toBe("29.97 USDT")
  })

  it("useExecuteTransaction returns a receipt", async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useExecuteTransaction(), { wrapper })
    const receipt = await result.current.mutateAsync({ action: "buy" })
    expect(receipt.kind).toBe("receipt")
  })

  it("useExecuteTransaction invalidates balances on success", async () => {
    const { client, wrapper } = makeWrapper()
    const spy = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useExecuteTransaction(), { wrapper })
    await result.current.mutateAsync({ action: "buy" })
    expect(spy).toHaveBeenCalledWith({ queryKey: ["balances"] })
  })
})
