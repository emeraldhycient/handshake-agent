/**
 * TDD tests for KycForm — written BEFORE the implementation.
 *
 * Tests:
 *  1. Renders all required fields
 *  2. Client validation blocks empty/invalid submit
 *  3. Valid submit calls mutation with parsed payload including token
 *  4. Shows success state on resolve
 *  5. Surfaces server error on reject
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { KycForm } from "./KycForm"

// ─── Module mock for the kyc api client ─────────────────────────────────────

vi.mock("@/lib/api/kyc", () => ({
  submitKycComplete: vi.fn(),
}))

import { submitKycComplete } from "@/lib/api/kyc"

const mockSubmit = vi.mocked(submitKycComplete)

// ─── Test helper ─────────────────────────────────────────────────────────────

function renderForm(token: string) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <KycForm token={token} />
    </QueryClientProvider>
  )
}

const VALID_TOKEN = "test-handoff-token-abc123"

const VALID_PAYLOAD = {
  firstName: "Amara",
  lastName: "Okafor",
  dateOfBirth: "1992-07-14",
  bvn: "12345678901",
  nin: "12345678901",
  pin: "1234",
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("KycForm", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("renders all required form fields", () => {
    renderForm(VALID_TOKEN)

    expect(
      screen.getByRole("textbox", { name: /first name/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("textbox", { name: /last name/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("textbox", { name: /date of birth/i })
    ).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: /bvn/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument()
  })

  it("blocks submit when required fields are empty", async () => {
    const user = userEvent.setup()
    renderForm(VALID_TOKEN)

    await user.click(screen.getByRole("button", { name: /submit/i }))

    // Mutation should not have been called
    expect(mockSubmit).not.toHaveBeenCalled()
    // Validation error messages should appear for the firstName field
    await waitFor(() => {
      // The firstName field error is linked via aria-describedby="kyc-firstName-error"
      expect(document.getElementById("kyc-firstName-error")).toBeInTheDocument()
    })
  })

  it("calls mutation with parsed payload including token on valid submit", async () => {
    const user = userEvent.setup()
    mockSubmit.mockResolvedValueOnce({
      userId: "11111111-1111-1111-1111-111111111111",
      status: "verified",
    })
    renderForm(VALID_TOKEN)

    await user.type(
      screen.getByRole("textbox", { name: /first name/i }),
      VALID_PAYLOAD.firstName
    )
    await user.type(
      screen.getByRole("textbox", { name: /last name/i }),
      VALID_PAYLOAD.lastName
    )
    await user.type(
      screen.getByRole("textbox", { name: /date of birth/i }),
      VALID_PAYLOAD.dateOfBirth
    )
    await user.type(
      screen.getByRole("textbox", { name: /bvn/i }),
      VALID_PAYLOAD.bvn
    )

    // PIN field is type="password" — use getByLabelText
    await user.type(screen.getByLabelText(/pin/i), VALID_PAYLOAD.pin)

    await user.click(screen.getByRole("button", { name: /submit/i }))

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledTimes(1)
    })

    const calledWith = mockSubmit.mock.calls[0][0]
    expect(calledWith).toMatchObject({
      token: VALID_TOKEN,
      firstName: VALID_PAYLOAD.firstName,
      lastName: VALID_PAYLOAD.lastName,
      pin: VALID_PAYLOAD.pin,
    })
  })

  it("shows success confirmation after successful submission", async () => {
    const user = userEvent.setup()
    mockSubmit.mockResolvedValueOnce({
      userId: "11111111-1111-1111-1111-111111111111",
      status: "verified",
    })
    renderForm(VALID_TOKEN)

    await user.type(
      screen.getByRole("textbox", { name: /first name/i }),
      VALID_PAYLOAD.firstName
    )
    await user.type(
      screen.getByRole("textbox", { name: /last name/i }),
      VALID_PAYLOAD.lastName
    )
    await user.type(
      screen.getByRole("textbox", { name: /date of birth/i }),
      VALID_PAYLOAD.dateOfBirth
    )
    await user.type(
      screen.getByRole("textbox", { name: /bvn/i }),
      VALID_PAYLOAD.bvn
    )
    await user.type(screen.getByLabelText(/pin/i), VALID_PAYLOAD.pin)

    await user.click(screen.getByRole("button", { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByText(/verification submitted/i)).toBeInTheDocument()
    })
    // Should tell the user to return to WhatsApp
    expect(screen.getByText(/return to whatsapp/i)).toBeInTheDocument()
  })

  it("surfaces server error message on mutation rejection", async () => {
    const user = userEvent.setup()
    // TanStack Query mutation with throwOnError: false (default) — error is stored
    // in mutation.error and shown in the UI. The rejection is expected.
    mockSubmit.mockRejectedValueOnce(new Error("Token expired or invalid"))
    renderForm(VALID_TOKEN)

    await user.type(
      screen.getByRole("textbox", { name: /first name/i }),
      VALID_PAYLOAD.firstName
    )
    await user.type(
      screen.getByRole("textbox", { name: /last name/i }),
      VALID_PAYLOAD.lastName
    )
    await user.type(
      screen.getByRole("textbox", { name: /date of birth/i }),
      VALID_PAYLOAD.dateOfBirth
    )
    await user.type(
      screen.getByRole("textbox", { name: /bvn/i }),
      VALID_PAYLOAD.bvn
    )
    await user.type(screen.getByLabelText(/pin/i), VALID_PAYLOAD.pin)

    // Submit — the error is caught inside the component (onSubmit catches mutateAsync)
    // and exposed via mutation.error, so no unhandled rejection in the test.
    await user.click(screen.getByRole("button", { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByText(/token expired or invalid/i)).toBeInTheDocument()
    })
  })
})
