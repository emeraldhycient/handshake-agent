/**
 * TDD tests for the /kyc page — written BEFORE the implementation.
 *
 * Tests:
 *  1. Missing token → "invalid or expired link" state, no form rendered
 *  2. With token → renders the KycForm (form fields visible)
 */
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// ─── Module mock for the kyc api client ─────────────────────────────────────

vi.mock("@/lib/api/kyc", () => ({
  submitKycComplete: vi.fn(),
}))

// The page is a Server Component that awaits searchParams — we test its logic
// by importing the default export and calling it as an async function.
import KycPage from "./page"

function Wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

async function renderPage(searchParams?: Record<string, string>) {
  // searchParams is a Promise<Record<string, string>> in Next 16
  const params = Promise.resolve(searchParams ?? {})
  const ui = await KycPage({ searchParams: params })
  return render(<Wrapper>{ui}</Wrapper>)
}

describe("KYC page", () => {
  it("shows invalid-link state when token is missing", async () => {
    await renderPage({})

    expect(screen.getByText(/invalid or expired link/i)).toBeInTheDocument()
    // Form fields must NOT be present
    expect(
      screen.queryByRole("textbox", { name: /first name/i })
    ).not.toBeInTheDocument()
  })

  it("shows invalid-link state when token is empty string", async () => {
    await renderPage({ t: "" })

    expect(screen.getByText(/invalid or expired link/i)).toBeInTheDocument()
    expect(
      screen.queryByRole("textbox", { name: /first name/i })
    ).not.toBeInTheDocument()
  })

  it("renders the KycForm when a valid token is present", async () => {
    await renderPage({ t: "valid-token-xyz" })

    // The form should be rendered with fields
    expect(
      screen.getByRole("textbox", { name: /first name/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("textbox", { name: /last name/i })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument()
  })
})
