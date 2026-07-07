/**
 * BeneficiariesPage guard test — the beneficiary oversight list, wired to
 * `useAdminBeneficiaries()` (GET /admin/beneficiaries, optionally user-scoped). The
 * row-formatting helpers are unit-tested in `lib/beneficiaries/rows.test.ts`; here we
 * assert the four async branches, a data row (label · type · verification · cooling-off),
 * and that typing a user id re-scopes the read. The api layer is mocked and the
 * step-up-gated override is stubbed so the page is tested in isolation.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminBeneficiary,
  AdminBeneficiaryListResponse,
} from "@handshake-agent/contracts"

import { BeneficiariesPage } from "@/components/admin/beneficiaries-page"

vi.mock("@/lib/api/beneficiaries", () => ({ listBeneficiaries: vi.fn() }))

// Stub the step-up-gated override so the page test doesn't pull its own deps.
vi.mock("@/components/admin/beneficiary-override", () => ({
  BeneficiaryOverride: () => <div>OVERRIDE</div>,
}))

import { listBeneficiaries } from "@/lib/api/beneficiaries"

const mockList = vi.mocked(listBeneficiaries)

const BANK: AdminBeneficiary = {
  id: "ben-1",
  userId: "user-1",
  type: "bank_account",
  label: "GTBank · 0123",
  verificationStatus: "verified",
  firstUseLockedUntil: null,
  coolingOffActive: false,
  createdAt: "2026-07-01T00:00:00.000Z",
}

const RESPONSE: AdminBeneficiaryListResponse = { items: [BANK] }

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <BeneficiariesPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockList.mockReset().mockResolvedValue(RESPONSE)
})

describe("BeneficiariesPage", () => {
  it("renders a beneficiary row (label · type · verification · cleared)", async () => {
    renderPage()

    expect(await screen.findByText("GTBank · 0123")).toBeInTheDocument()
    expect(screen.getByText("Bank account")).toBeInTheDocument()
    expect(screen.getByText("verified")).toBeInTheDocument()
    // Not in cooling-off → the "Cleared" affordance, and the override stub renders.
    expect(screen.getByText("Cleared")).toBeInTheDocument()
    expect(screen.getByText("OVERRIDE")).toBeInTheDocument()
  })

  it("re-scopes the read when a user id is typed", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("GTBank · 0123")
    expect(mockList).toHaveBeenLastCalledWith(undefined)

    await user.type(screen.getByLabelText("User id"), "user-1")

    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith("user-1"))
  })

  it("shows the empty state for a scope with no beneficiaries", async () => {
    mockList.mockResolvedValue({ items: [] })
    renderPage()
    expect(await screen.findByText("No beneficiaries")).toBeInTheDocument()
  })

  it("shows the error state when the list fetch fails", async () => {
    mockList.mockRejectedValue(new Error("boom"))
    renderPage()
    expect(
      await screen.findByText("Failed to load beneficiaries")
    ).toBeInTheDocument()
  })
})
