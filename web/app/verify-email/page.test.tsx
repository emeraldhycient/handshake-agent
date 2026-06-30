/**
 * TDD tests for the /verify-email page (Server Component that awaits
 * searchParams). Focus: the no-token empty state must reassure the user and
 * offer a resend affordance — never the misleading "sign up again" wording that
 * implies a duplicate account.
 */
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

vi.mock("@/lib/api/auth", () => ({
  submitVerifyEmail: vi.fn(),
}))

import VerifyEmailPage from "./page"

function Wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

async function renderPage(searchParams?: Record<string, string>) {
  const params = Promise.resolve(searchParams ?? {})
  const ui = await VerifyEmailPage({ searchParams: params })
  return render(<Wrapper>{ui}</Wrapper>)
}

describe("VerifyEmailPage no-token empty state", () => {
  it("offers a 'Resend verification email' affordance (not 'sign up again')", async () => {
    await renderPage({})

    const resend = screen.getByRole("link", {
      name: /resend verification email|request a new link/i,
    })
    expect(resend).toHaveAttribute("href", "/signup")

    // Reassurance: resending must not feel like creating a duplicate account.
    expect(
      screen.getByText(/won'?t create a duplicate account/i)
    ).toBeInTheDocument()

    // The misleading "sign up again" wording must be gone.
    expect(screen.queryByText(/sign up again/i)).not.toBeInTheDocument()
  })

  it("renders the verify form when a token is present", async () => {
    await renderPage({ token: "tok-123" })

    expect(
      screen.getByRole("button", { name: /verify email/i })
    ).toBeInTheDocument()
  })
})
