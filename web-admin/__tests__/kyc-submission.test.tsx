/**
 * KycSubmission + KycReviewActions tests.
 *
 *  3. The submission drawer shows ONLY the last-4 of NIN/BVN — a full NIN string
 *     is never rendered (PII minimization).
 *  4. Approve calls the api with the tier selected in the drawer.
 *
 * The api layer is mocked — no server. The submission detail carries only
 * `ninLast4`/`bvnLast4` (the contract has no full value), so the test also
 * asserts the rendered DOM contains the last-4 and not a full 11-digit NIN.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminMe, KycSubmissionDetail } from "@handshake-agent/contracts"

import { KycSubmission } from "@/components/admin/kyc-submission"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

vi.mock("@/lib/api/kyc", () => ({
  getKycSubmission: vi.fn(),
  approveKyc: vi.fn(),
  rejectKyc: vi.fn(),
}))

import { getMe } from "@/lib/api/admin"
import { getKycSubmission, approveKyc } from "@/lib/api/kyc"

const mockGetMe = vi.mocked(getMe)
const mockGetSubmission = vi.mocked(getKycSubmission)
const mockApprove = vi.mocked(approveKyc)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = "11111111-1111-1111-1111-111111111111"
// A full NIN that must NEVER appear in the DOM — only its last 4 (6789) may.
const FULL_NIN = "12345006789"

const ADMIN_ME: AdminMe = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@example.com",
  role: { id: "00000000-0000-0000-0000-0000000000aa", name: "compliance" },
  status: "active",
  mfaEnabled: false,
  permissions: [],
  menus: [],
  pages: [],
}

const SUBMISSION: KycSubmissionDetail = {
  userId: USER_ID,
  firstName: "Ada",
  lastName: "Lovelace",
  dateOfBirth: "1990-12-10",
  ninLast4: "6789",
  bvnLast4: "4321",
  idDocumentType: "national_id",
  livenessResult: "passed",
  status: "pending_review",
  tier: "tier_1",
  rejectionReason: null,
}

function renderDrawer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <KycSubmission userId={USER_ID} onOpenChange={() => {}} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockGetMe.mockReset()
  mockGetSubmission.mockReset()
  mockApprove.mockReset()
  mockGetMe.mockResolvedValue(ADMIN_ME)
  mockGetSubmission.mockResolvedValue(SUBMISSION)
  mockApprove.mockResolvedValue(undefined)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("KycSubmission", () => {
  it("renders only the last-4 of NIN, never the full value", async () => {
    const { container } = renderDrawer()

    // Last-4 masked values appear.
    expect(await screen.findByText("•••• 6789")).toBeInTheDocument()
    expect(screen.getByText("•••• 4321")).toBeInTheDocument()

    // The full NIN string is never present anywhere in the rendered DOM.
    expect(container.textContent).not.toContain(FULL_NIN)
    expect(container.textContent).not.toContain("12345")
  })

  it("approve calls the api with the selected tier", async () => {
    const user = userEvent.setup()
    renderDrawer()

    const tierSelect = await screen.findByLabelText("Approve to tier")
    await user.selectOptions(tierSelect, "tier_3")
    await user.click(screen.getByRole("button", { name: "Approve" }))

    await waitFor(() =>
      expect(mockApprove).toHaveBeenCalledWith(USER_ID, { tier: "tier_3" })
    )
  })
})
