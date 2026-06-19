import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import AppPage from "./page"

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe("/app page", () => {
  it("renders MobileShell with the chat header", () => {
    render(<AppPage />, { wrapper })
    expect(screen.getByText("Handshake Agent")).toBeInTheDocument()
  })

  it("renders the bottom navigation", () => {
    render(<AppPage />, { wrapper })
    expect(
      screen.getByRole("navigation", { name: /main navigation/i })
    ).toBeInTheDocument()
  })
})
