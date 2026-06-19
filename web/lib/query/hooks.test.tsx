import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useBalances, useExecuteTransaction } from "./hooks"

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe("query hooks", () => {
  it("useBalances loads", async () => {
    const { result } = renderHook(() => useBalances(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.total).toBe("≈ ₦72,340")
  })
  it("useExecuteTransaction returns a receipt", async () => {
    const { result } = renderHook(() => useExecuteTransaction(), { wrapper })
    const receipt = await result.current.mutateAsync({ action: "buy" })
    expect(receipt.kind).toBe("receipt")
  })
})
