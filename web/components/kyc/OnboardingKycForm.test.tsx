/**
 * TDD tests for OnboardingKycForm — written alongside the implementation.
 *
 * Tests:
 *  1. Renders all required fields (firstName, lastName, pin, confirmPin)
 *  2. Blocks submit when required fields are empty — mutation not called
 *  3. Blocks submit when pin !== confirmPin — mutation not called, error shown
 *  4. Valid submit calls submitKycSession with correct body (no confirmPin), navigates to /
 *  5. Surfaces server error on mutation rejection
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { OnboardingKycForm } from "./OnboardingKycForm"

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("@/lib/api/kyc", () => ({
  submitKycComplete: vi.fn(),
  submitKycSession: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

import { submitKycSession } from "@/lib/api/kyc"

const mockSubmit = vi.mocked(submitKycSession)
const mockRouterPush = vi.fn()

// ─── Test helper ─────────────────────────────────────────────────────────────

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <OnboardingKycForm />
    </QueryClientProvider>
  )
}

const VALID_PAYLOAD = {
  firstName: "Amara",
  lastName: "Okafor",
  pin: "1234",
  confirmPin: "1234",
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("OnboardingKycForm", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("renders all required form fields including pin and confirmPin", () => {
    renderForm()

    expect(
      screen.getByRole("textbox", { name: /first name/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("textbox", { name: /last name/i })
    ).toBeInTheDocument()
    // PIN fields are type="password" — use getByLabelText
    expect(screen.getByLabelText(/^transaction pin/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/confirm pin/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument()
  })

  it("blocks submit when required fields are empty — mutation not called", async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole("button", { name: /submit/i }))

    // Mutation must not have been called
    expect(mockSubmit).not.toHaveBeenCalled()

    // firstName validation error should appear
    await waitFor(() => {
      expect(document.getElementById("onb-firstName-error")).toBeInTheDocument()
    })
  })

  it("blocks submit when pin and confirmPin do not match — error shown", async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(
      screen.getByRole("textbox", { name: /first name/i }),
      VALID_PAYLOAD.firstName
    )
    await user.type(
      screen.getByRole("textbox", { name: /last name/i }),
      VALID_PAYLOAD.lastName
    )
    await user.type(screen.getByLabelText(/^transaction pin/i), "1234")
    await user.type(screen.getByLabelText(/confirm pin/i), "9999")

    await user.click(screen.getByRole("button", { name: /submit/i }))

    // Mutation must not have been called
    expect(mockSubmit).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(screen.getByText(/pins do not match/i)).toBeInTheDocument()
    })
  })

  it("calls submitKycSession with correct body (no confirmPin) and navigates to / on success", async () => {
    const user = userEvent.setup()
    mockSubmit.mockResolvedValueOnce({
      userId: "11111111-1111-1111-1111-111111111111",
      status: "verified",
    })
    renderForm()

    await user.type(
      screen.getByRole("textbox", { name: /first name/i }),
      VALID_PAYLOAD.firstName
    )
    await user.type(
      screen.getByRole("textbox", { name: /last name/i }),
      VALID_PAYLOAD.lastName
    )
    await user.type(
      screen.getByLabelText(/^transaction pin/i),
      VALID_PAYLOAD.pin
    )
    await user.type(
      screen.getByLabelText(/confirm pin/i),
      VALID_PAYLOAD.confirmPin
    )

    await user.click(screen.getByRole("button", { name: /submit/i }))

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledTimes(1)
    })

    const calledWith = mockSubmit.mock.calls[0][0]

    // Body must include the KYC fields
    expect(calledWith).toMatchObject({
      firstName: VALID_PAYLOAD.firstName,
      lastName: VALID_PAYLOAD.lastName,
      pin: VALID_PAYLOAD.pin,
    })

    // confirmPin must NOT be in the body sent to the API
    expect(calledWith).not.toHaveProperty("confirmPin")

    // Should navigate to / on success
    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith("/")
    })
  })

  it("surfaces server error message on mutation rejection", async () => {
    const user = userEvent.setup()
    mockSubmit.mockRejectedValueOnce(new Error("KYC submission failed"))
    renderForm()

    await user.type(
      screen.getByRole("textbox", { name: /first name/i }),
      VALID_PAYLOAD.firstName
    )
    await user.type(
      screen.getByRole("textbox", { name: /last name/i }),
      VALID_PAYLOAD.lastName
    )
    await user.type(
      screen.getByLabelText(/^transaction pin/i),
      VALID_PAYLOAD.pin
    )
    await user.type(
      screen.getByLabelText(/confirm pin/i),
      VALID_PAYLOAD.confirmPin
    )

    // Submit — the error is caught inside the component (onSubmit catches mutateAsync)
    // and exposed via mutation.error, so no unhandled rejection in the test.
    await user.click(screen.getByRole("button", { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByText(/kyc submission failed/i)).toBeInTheDocument()
    })
  })
})
