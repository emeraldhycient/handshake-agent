/**
 * UserDetail — KYC-decision WRITE tests (Phase 7). The KYC tab's Approve / Reject
 * actions are now wired to the real `useApproveKyc` / `useRejectKyc` mutations
 * (POST /admin/kyc/:id/approve|reject) through the shared funds-safety flow chain:
 *
 *  - Approve → reason → step-up → maker-checker (dual control) → POST approve with
 *    the submission's requested (verified) tier. Never promotes to 'unverified'.
 *  - Reject → reason (required) → POST reject with the captured reason.
 *  - Request more info → reason → step-up → POST /admin/kyc/:id/request-info, bouncing
 *    the review back to the user (Phase 9).
 *  - A mutation that 403s with ADMIN_STEP_UP_REQUIRED opens the real StepUpDialog
 *    (server re-auth); on success the stashed mutation replays.
 *
 * The api layer is mocked (no server). This file is isolated to the KYC-decision
 * slice so it does not contend with the broader user-detail render tests.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminEndUserDetail,
  KycSubmissionDetail,
} from "@handshake-agent/contracts"

import { UserDetail } from "@/components/admin/user-detail"
import { defaultToastStore } from "@/lib/store/toast-store"
import { ApiError } from "@/lib/api/client"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

const searchParams = new URLSearchParams("tab=kyc")

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParams,
}))

vi.mock("@/lib/api/users", () => ({
  getEndUser: vi.fn(),
  listEndUserDevices: vi.fn(),
  listEndUserSessions: vi.fn(),
  getEndUserLimits: vi.fn(),
  listEndUserTimeline: vi.fn(),
}))

vi.mock("@/lib/api/kyc", () => ({
  getKycSubmission: vi.fn(),
  approveKyc: vi.fn(),
  rejectKyc: vi.fn(),
  requestKycInfo: vi.fn(),
}))

// useAdminMe backs the StepUpDialog's MFA path; stepUp POSTs the re-auth.
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
  stepUp: vi.fn(),
}))

import {
  getEndUser,
  listEndUserDevices,
  listEndUserSessions,
  getEndUserLimits,
  listEndUserTimeline,
} from "@/lib/api/users"
import {
  getKycSubmission,
  approveKyc,
  rejectKyc,
  requestKycInfo,
} from "@/lib/api/kyc"
import { getMe, stepUp } from "@/lib/api/admin"

const mockGetEndUser = vi.mocked(getEndUser)
const mockGetKyc = vi.mocked(getKycSubmission)
const mockApprove = vi.mocked(approveKyc)
const mockReject = vi.mocked(rejectKyc)
const mockRequestInfo = vi.mocked(requestKycInfo)
const mockGetMe = vi.mocked(getMe)
const mockStepUp = vi.mocked(stepUp)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = "11111111-1111-1111-1111-111111111111"

const DETAIL: AdminEndUserDetail = {
  id: USER_ID,
  email: "ada.lovelace@example.com",
  status: "active",
  kycStatus: "pending",
  kycTier: "unverified",
  simSwapDetectedAt: null,
  phone: "+2348012345678",
  createdAt: "2024-01-01T00:00:00.000Z",
  devices: [],
  balances: [],
  depositAddresses: [],
  recentTransactions: [],
  recentLedger: [],
  beneficiaries: [],
}

const KYC: KycSubmissionDetail = {
  userId: USER_ID,
  firstName: "Ada",
  lastName: "Lovelace",
  dateOfBirth: "1990-12-10",
  ninLast4: "6789",
  bvnLast4: "4321",
  idDocumentType: "national_id",
  livenessResult: "passed",
  status: "pending",
  tier: "tier_2",
  rejectionReason: null,
}

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <UserDetail userId={USER_ID} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
  vi.clearAllMocks()
  mockGetEndUser.mockResolvedValue(DETAIL)
  vi.mocked(listEndUserDevices).mockResolvedValue([])
  vi.mocked(listEndUserSessions).mockResolvedValue([])
  vi.mocked(getEndUserLimits).mockResolvedValue({
    effectiveLimits: null,
    velocity: {
      dailyFiatUsed: "0",
      dailyTxCount: 0,
      fiatCurrency: "NGN",
      windowStart: "2024-02-09T00:00:00.000Z",
      windowEnd: "2024-02-10T00:00:00.000Z",
    },
  } as never)
  vi.mocked(listEndUserTimeline).mockResolvedValue([])
  mockGetKyc.mockResolvedValue(KYC)
  mockApprove.mockResolvedValue(undefined)
  mockReject.mockResolvedValue(undefined)
  mockRequestInfo.mockResolvedValue(undefined)
  mockGetMe.mockResolvedValue({ mfaEnabled: true } as never)
  mockStepUp.mockResolvedValue(undefined)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("UserDetail — KYC decisions (Phase 7 WRITE)", () => {
  it("approves through reason → confirm, promoting to the requested tier", async () => {
    const user = userEvent.setup()
    renderDetail()

    // Approve opens the reason modal (the requested tier is surfaced on the CTA).
    const approveBtn = await screen.findByRole("button", {
      name: /Approve · tier_2/,
    })
    await user.click(approveBtn)

    // Reason step — a reason is required before Continue.
    await user.type(await screen.findByLabelText("Reason"), "Docs verified")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    // Confirm step (honest immediate copy — the approve POST applies right after
    // the SERVER-side step-up gate; no ChangeRequest is raised).
    await user.click(
      await screen.findByRole("button", { name: "Confirm change" })
    )

    // The real approve mutation fires with the submission's requested verified tier.
    await waitFor(() =>
      expect(mockApprove).toHaveBeenCalledWith(USER_ID, { tier: "tier_2" })
    )
    expect(mockReject).not.toHaveBeenCalled()
  })

  it("rejects with the captured reason (reject fires no approve)", async () => {
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole("button", { name: "Reject" }))

    await user.type(
      await screen.findByLabelText("Reason"),
      "Selfie does not match ID"
    )
    await user.click(screen.getByRole("button", { name: "Continue" }))

    await waitFor(() =>
      expect(mockReject).toHaveBeenCalledWith(USER_ID, {
        reason: "Selfie does not match ID",
      })
    )
    expect(mockApprove).not.toHaveBeenCalled()
  })

  it("request-info → reason fires requestKycInfo (no approve/reject)", async () => {
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole("button", { name: "Request info" }))
    await user.type(await screen.findByLabelText("Reason"), "Need a clearer ID")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    await waitFor(() =>
      expect(mockRequestInfo).toHaveBeenCalledWith(USER_ID, "Need a clearer ID")
    )
    // The needs-info bounce is distinct from the approve/reject decisions.
    expect(mockApprove).not.toHaveBeenCalled()
    expect(mockReject).not.toHaveBeenCalled()
  })

  it("opens the real step-up dialog and retries when reject 403s ADMIN_STEP_UP_REQUIRED", async () => {
    const user = userEvent.setup()
    // First reject attempt 403s (step-up required); the retry after re-auth succeeds.
    mockReject
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce(undefined)

    renderDetail()

    await user.click(await screen.findByRole("button", { name: "Reject" }))
    await user.type(await screen.findByLabelText("Reason"), "Mismatch")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    // The 403 opens the real server re-auth dialog (distinct from the flow keypad).
    const confirm = await screen.findByRole("button", { name: "Confirm" })
    await user.type(
      screen.getByLabelText("Authenticator code (TOTP)"),
      "654321"
    )
    await user.click(confirm)

    // Re-auth POSTs step-up, then the stashed reject replays and settles.
    await waitFor(() => expect(mockStepUp).toHaveBeenCalledOnce())
    await waitFor(() => expect(mockReject).toHaveBeenCalledTimes(2))
  })
})
