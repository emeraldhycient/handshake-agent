/**
 * BeneficiaryOverride guard test — the step-up-gated control that clears a
 * beneficiary's first-use cooling-off lock (IDN-08). The component surfaces a
 * failed override through the canonical `toErrorMessage` (`lib/error-message`);
 * these cases pin that rendered copy for both error shapes the admin api throws
 * (a plain `Error` and an `ApiError`), plus the hidden branch when the lock is
 * already cleared. The api layer is mocked so nothing leaves the test.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminBeneficiary } from "@handshake-agent/contracts"

import { ApiError } from "@/lib/api/client"
import { BeneficiaryOverride } from "@/components/admin/beneficiary-override"

vi.mock("@/lib/api/beneficiaries", () => ({
  listBeneficiaries: vi.fn(),
  overrideCoolingOff: vi.fn(),
}))

vi.mock("@/lib/api/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/admin")>()),
  getMe: vi.fn().mockResolvedValue({ mfaEnabled: false }),
}))

import { overrideCoolingOff } from "@/lib/api/beneficiaries"

const mockOverride = vi.mocked(overrideCoolingOff)

const LOCKED: AdminBeneficiary = {
  id: "ben-1",
  userId: "user-1",
  type: "bank_account",
  label: "GTBank · 0123",
  verificationStatus: "verified",
  firstUseLockedUntil: "2026-07-21T00:00:00.000Z",
  coolingOffActive: true,
  createdAt: "2026-07-01T00:00:00.000Z",
}

function renderOverride(beneficiary: AdminBeneficiary = LOCKED) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <BeneficiaryOverride beneficiary={beneficiary} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockOverride.mockReset()
})

describe("BeneficiaryOverride", () => {
  it("renders nothing once the cooling-off lock is cleared", () => {
    const { container } = renderOverride({ ...LOCKED, coolingOffActive: false })
    expect(container).toBeEmptyDOMElement()
  })

  it("surfaces a failed override's message in an alert", async () => {
    const user = userEvent.setup()
    mockOverride.mockRejectedValue(new Error("Override rejected upstream"))
    renderOverride()

    await user.click(screen.getByRole("button", { name: "Override cooling-off" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Override rejected upstream"
    )
  })

  it("surfaces an ApiError's message (not a generic fallback)", async () => {
    const user = userEvent.setup()
    mockOverride.mockRejectedValue(
      new ApiError("Beneficiary is no longer locked", 409, "CONFLICT")
    )
    renderOverride()

    await user.click(screen.getByRole("button", { name: "Override cooling-off" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Beneficiary is no longer locked"
    )
  })

  it("shows no alert while the override is still in flight", () => {
    mockOverride.mockReturnValue(new Promise(() => {}))
    renderOverride()

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
