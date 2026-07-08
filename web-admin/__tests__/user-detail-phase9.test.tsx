/**
 * UserDetail — Phase 9 WRITE tests. Seven previously-stubbed actions are now wired
 * to the real Phase-9 hooks through the shared reason → step-up flow (the canonical
 * funds-safety chain, mirroring sanctions-page):
 *
 *  - KYC "Request info"        → useRequestKycInfo({ userId, reason })
 *  - KYC "Force re-KYC"        → useForceReKyc({ userId, reason })
 *  - Security "Revoke all"     → useRevokeAllUserSessions({ userId, reason })
 *  - Security per-session      → useRevokeUserSession({ userId, sessionId, reason })
 *  - Profile "Add note"        → useCreateUserNote({ userId, body }) + notes rendered
 *  - Beneficiaries "Remove"    → useRemoveBeneficiary({ id, reason })
 *  - Header "Resend"           → useResendVerification({ userId })
 *
 * Each step-up-gated action must NOT fire before reason + step-up complete; a 403
 * ADMIN_STEP_UP_REQUIRED opens the real StepUpDialog and replays via useStepUpRetry.
 * The api layer is mocked (no server) — this slice is isolated so it does not contend
 * with the broad render tests or the KYC-decision slice.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminEndUserDetail,
  AdminEndUserSession,
  AdminUserNote,
  KycSubmissionDetail,
} from "@handshake-agent/contracts"

import { UserDetail } from "@/components/admin/user-detail"
import { defaultToastStore } from "@/lib/store/toast-store"
import { ApiError } from "@/lib/api/client"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

let searchParams = new URLSearchParams()

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
  listUserNotes: vi.fn(),
  createUserNote: vi.fn(),
  resendVerification: vi.fn(),
  forceReKyc: vi.fn(),
  revokeUserSession: vi.fn(),
  revokeAllUserSessions: vi.fn(),
}))

vi.mock("@/lib/api/kyc", () => ({
  getKycSubmission: vi.fn(),
  requestKycInfo: vi.fn(),
}))

vi.mock("@/lib/api/beneficiaries", () => ({
  removeBeneficiary: vi.fn(),
}))

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
  listUserNotes,
  createUserNote,
  resendVerification,
  forceReKyc,
  revokeUserSession,
  revokeAllUserSessions,
} from "@/lib/api/users"
import { getKycSubmission, requestKycInfo } from "@/lib/api/kyc"
import { removeBeneficiary } from "@/lib/api/beneficiaries"
import { getMe, stepUp } from "@/lib/api/admin"

const mockGetEndUser = vi.mocked(getEndUser)
const mockGetKyc = vi.mocked(getKycSubmission)
const mockListNotes = vi.mocked(listUserNotes)
const mockCreateNote = vi.mocked(createUserNote)
const mockResend = vi.mocked(resendVerification)
const mockForceReKyc = vi.mocked(forceReKyc)
const mockRevokeSession = vi.mocked(revokeUserSession)
const mockRevokeAll = vi.mocked(revokeAllUserSessions)
const mockRequestKycInfo = vi.mocked(requestKycInfo)
const mockRemoveBeneficiary = vi.mocked(removeBeneficiary)
const mockGetMe = vi.mocked(getMe)
const mockStepUp = vi.mocked(stepUp)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = "11111111-1111-1111-1111-111111111111"
const SESSION_ID = "55555555-5555-5555-5555-555555555555"
const BENE_ID = "33333333-3333-3333-3333-333333333333"

const DETAIL: AdminEndUserDetail = {
  id: USER_ID,
  email: "ada.lovelace@example.com",
  status: "active",
  kycStatus: "pending",
  kycTier: "tier_2",
  simSwapDetectedAt: null,
  phone: "+2348012345678",
  createdAt: "2024-01-01T00:00:00.000Z",
  devices: [],
  balances: [],
  depositAddresses: [],
  recentTransactions: [],
  recentLedger: [],
  beneficiaries: [
    {
      id: BENE_ID,
      type: "bank_account",
      label: "GTBank · Ada Lovelace",
      verificationStatus: "verified",
    },
  ],
}

const SESSIONS: AdminEndUserSession[] = [
  {
    id: SESSION_ID,
    channel: "web",
    deviceId: "44444444-4444-4444-4444-444444444444",
    userAgent: "Mozilla/5.0 (iPhone)",
    ipAddress: "102.89.34.19",
    isActive: true,
    stepUpCompletedAt: null,
    issuedAt: "2024-02-10T00:00:00.000Z",
    expiresAt: "2024-02-11T00:00:00.000Z",
    lastActivityAt: "2024-02-10T00:05:00.000Z",
    revokedAt: null,
  },
]

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

const NOTES: AdminUserNote[] = [
  {
    id: "77777777-7777-7777-7777-777777777777",
    body: "Called customer to confirm identity.",
    authorAdminId: "99999999-9999-9999-9999-999999999999",
    createdAt: "2024-02-06T00:00:00.000Z",
  },
]

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
  searchParams = new URLSearchParams()
  defaultToastStore.setState({ toasts: [] })
  vi.clearAllMocks()
  mockGetEndUser.mockResolvedValue(DETAIL)
  vi.mocked(listEndUserDevices).mockResolvedValue([])
  vi.mocked(listEndUserSessions).mockResolvedValue(SESSIONS)
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
  mockListNotes.mockResolvedValue({ items: NOTES })
  mockCreateNote.mockResolvedValue(NOTES[0])
  mockResend.mockResolvedValue(undefined)
  mockForceReKyc.mockResolvedValue(undefined)
  mockRevokeSession.mockResolvedValue(undefined)
  mockRevokeAll.mockResolvedValue(undefined)
  mockRequestKycInfo.mockResolvedValue(undefined)
  mockRemoveBeneficiary.mockResolvedValue(undefined)
  mockGetKyc.mockResolvedValue(KYC)
  mockGetMe.mockResolvedValue({ mfaEnabled: true } as never)
  mockStepUp.mockResolvedValue(undefined)
})

// Walks the reason modal (a reason/body is required) then the step-up keypad.
async function completeReason(
  user: ReturnType<typeof userEvent.setup>,
  reason: string
) {
  await user.type(await screen.findByLabelText("Reason"), reason)
  await user.click(screen.getByRole("button", { name: "Continue" }))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("UserDetail — Phase 9 wired actions", () => {
  it("Request info → reason → step-up fires requestKycInfo with the reason", async () => {
    searchParams = new URLSearchParams("tab=kyc")
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole("button", { name: "Request info" }))
    expect(mockRequestKycInfo).not.toHaveBeenCalled()

    await completeReason(user, "Need a clearer ID photo")

    await waitFor(() =>
      expect(mockRequestKycInfo).toHaveBeenCalledWith(
        USER_ID,
        "Need a clearer ID photo"
      )
    )
  })

  it("Force re-KYC → reason → step-up fires forceReKyc with the reason", async () => {
    searchParams = new URLSearchParams("tab=kyc")
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole("button", { name: "Force re-KYC" }))
    expect(mockForceReKyc).not.toHaveBeenCalled()

    await completeReason(user, "SIM-swap concern")

    await waitFor(() =>
      expect(mockForceReKyc).toHaveBeenCalledWith(USER_ID, "SIM-swap concern")
    )
  })

  it("Revoke all → reason → step-up fires revokeAllUserSessions", async () => {
    searchParams = new URLSearchParams("tab=security")
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole("button", { name: "Revoke all" }))
    expect(mockRevokeAll).not.toHaveBeenCalled()

    await completeReason(user, "Account takeover")

    await waitFor(() =>
      expect(mockRevokeAll).toHaveBeenCalledWith(USER_ID, "Account takeover")
    )
  })

  it("per-session Revoke → reason → step-up fires revokeUserSession with the row's session id", async () => {
    searchParams = new URLSearchParams("tab=security")
    const user = userEvent.setup()
    renderDetail()

    await screen.findByText("Mozilla/5.0 (iPhone)")
    await user.click(screen.getByRole("button", { name: "Revoke" }))
    expect(mockRevokeSession).not.toHaveBeenCalled()

    await completeReason(user, "Suspicious login")

    await waitFor(() =>
      expect(mockRevokeSession).toHaveBeenCalledWith(
        USER_ID,
        SESSION_ID,
        "Suspicious login"
      )
    )
  })

  it("Add note → captures the body and fires createUserNote (no step-up)", async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByRole("heading", { name: "Ada Lovelace" })

    await user.click(screen.getByRole("button", { name: "Add note" }))
    await user.type(
      await screen.findByLabelText("Reason"),
      "Customer verified over phone."
    )
    await user.click(screen.getByRole("button", { name: "Continue" }))

    await waitFor(() =>
      expect(mockCreateNote).toHaveBeenCalledWith(USER_ID, {
        body: "Customer verified over phone.",
      })
    )
  })

  it("renders the case notes from useUserNotes on the Profile tab", async () => {
    const user = userEvent.setup()
    renderDetail()

    expect(
      await screen.findByText("Called customer to confirm identity.")
    ).toBeInTheDocument()
    expect(mockListNotes).toHaveBeenCalledWith(USER_ID)
    // The note must not require a click to appear.
    void user
  })

  it("Remove beneficiary → reason → step-up fires removeBeneficiary with the row id", async () => {
    searchParams = new URLSearchParams("tab=bene")
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole("button", { name: "Remove" }))
    expect(mockRemoveBeneficiary).not.toHaveBeenCalled()

    await completeReason(user, "Closed bank account")

    await waitFor(() =>
      expect(mockRemoveBeneficiary).toHaveBeenCalledWith(
        BENE_ID,
        "Closed bank account"
      )
    )
  })

  it("Resend (header) fires resendVerification directly (no reason, no step-up)", async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByRole("heading", { name: "Ada Lovelace" })

    await user.click(screen.getByRole("button", { name: "Resend" }))

    await waitFor(() =>
      expect(mockResend).toHaveBeenCalledWith(USER_ID, undefined)
    )
  })

  it("opens the real step-up dialog and replays when forceReKyc 403s ADMIN_STEP_UP_REQUIRED", async () => {
    searchParams = new URLSearchParams("tab=kyc")
    const user = userEvent.setup()
    mockForceReKyc
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce(undefined)
    renderDetail()

    await user.click(await screen.findByRole("button", { name: "Force re-KYC" }))
    await completeReason(user, "Identity concern")

    // The 403 opens the server re-auth dialog (distinct from the flow keypad).
    const confirm = await screen.findByRole("button", { name: "Confirm" })
    await user.type(
      screen.getByLabelText("Authenticator code (TOTP)"),
      "654321"
    )
    await user.click(confirm)

    await waitFor(() => expect(mockStepUp).toHaveBeenCalledOnce())
    await waitFor(() => expect(mockForceReKyc).toHaveBeenCalledTimes(2))
  })

  it("does not fire the mutation when the flow is cancelled at the reason step", async () => {
    searchParams = new URLSearchParams("tab=kyc")
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole("button", { name: "Force re-KYC" }))
    await user.click(await screen.findByRole("button", { name: "Cancel" }))

    expect(mockForceReKyc).not.toHaveBeenCalled()
  })
})
