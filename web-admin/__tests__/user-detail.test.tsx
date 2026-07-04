/**
 * UserDetail tests — the screen is now wired to REAL admin data via
 * `useEndUserDetail` / `useKycSubmission` / `useEndUserDevices` (Phase 6a). The api
 * layer is mocked (no server); each test drives a branch:
 *
 *  - loading → data: the aggregate resolves and the header + tab content render the
 *    mocked-real user (name derived from the KYC identity, id chip, KYC pill).
 *  - error: the aggregate rejects → the tokened error card with a Retry affordance.
 *  - empty: an aggregate with no wallets/beneficiaries/transactions renders the
 *    design-consistent empty states.
 *  - preserved design behaviour: the `?tab=` deep-link still seeds the active tab, and
 *    the KYC tab shows only the last-4 of NIN/BVN (never the full value).
 *
 * `next/navigation` is stubbed; the search params are swapped per-test via a mutable
 * holder so a single module mock serves both the default and deep-link cases.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminEndUserDetail,
  AdminEndUserDevice,
  AdminEndUserLimitsResponse,
  AdminEndUserSession,
  AdminEndUserTimelineEntry,
  KycSubmissionDetail,
} from "@handshake-agent/contracts"

import { UserDetail } from "@/components/admin/user-detail"
import { defaultToastStore } from "@/lib/store/toast-store"

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
  adjustTier: vi.fn(),
  setEndUserStatus: vi.fn(),
  forcePinReset: vi.fn(),
  revokeDevice: vi.fn(),
  simSwapReverify: vi.fn(),
  requestManualCredit: vi.fn(),
}))

vi.mock("@/lib/api/kyc", () => ({
  getKycSubmission: vi.fn(),
}))

// The signed-in admin (`useAdminMe`) + step-up POST (`useStepUp`) back the flow's
// step-up modal — the design's TOTP keypad now really establishes the fresh
// step-up the server's AdminStepUpGuard requires before a sensitive mutation.
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
  adjustTier,
  setEndUserStatus,
  forcePinReset,
  revokeDevice,
  simSwapReverify,
  requestManualCredit,
} from "@/lib/api/users"
import { getKycSubmission } from "@/lib/api/kyc"
import { getMe, stepUp } from "@/lib/api/admin"

const mockGetEndUser = vi.mocked(getEndUser)
const mockListDevices = vi.mocked(listEndUserDevices)
const mockListSessions = vi.mocked(listEndUserSessions)
const mockGetLimits = vi.mocked(getEndUserLimits)
const mockListTimeline = vi.mocked(listEndUserTimeline)
const mockListNotes = vi.mocked(listUserNotes)
const mockGetKyc = vi.mocked(getKycSubmission)
const mockAdjustTier = vi.mocked(adjustTier)
const mockSetStatus = vi.mocked(setEndUserStatus)
const mockForcePinReset = vi.mocked(forcePinReset)
const mockRevokeDevice = vi.mocked(revokeDevice)
const mockSimSwapReverify = vi.mocked(simSwapReverify)
const mockRequestManualCredit = vi.mocked(requestManualCredit)
const mockGetMe = vi.mocked(getMe)
const mockStepUp = vi.mocked(stepUp)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = "11111111-1111-1111-1111-111111111111"
const FULL_NIN = "23000006789"

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
  balances: [
    { asset: "USDT", network: "TRON", amount: "790.500000", pending: null },
    { asset: "TRX", network: "TRON", amount: "12.000000", pending: null },
  ],
  depositAddresses: [
    { network: "TRON", address: "TXaddr1234", status: "active" },
  ],
  recentTransactions: [
    {
      id: "22222222-2222-2222-2222-222222222222",
      type: "buy",
      status: "completed",
      asset: "USDT",
      amount: "100.00",
      fiatAmount: "150000.00",
      fiatCurrency: "NGN",
      createdAt: "2024-02-01T00:00:00.000Z",
    },
  ],
  recentLedger: [],
  beneficiaries: [
    {
      id: "33333333-3333-3333-3333-333333333333",
      type: "bank_account",
      label: "GTBank · Ada Lovelace",
      verificationStatus: "verified",
    },
  ],
}

const SESSIONS: AdminEndUserSession[] = [
  {
    id: "55555555-5555-5555-5555-555555555555",
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

const LIMITS: AdminEndUserLimitsResponse = {
  effectiveLimits: {
    tier: "tier_2",
    fiatCurrency: "NGN",
    perTxFiatMax: "5000000",
    dailyFiatMax: "50000000",
    dailyTxCountMax: 50,
  },
  velocity: {
    dailyFiatUsed: "252551.70",
    dailyTxCount: 6,
    windowStart: "2024-02-09T00:00:00.000Z",
    windowEnd: "2024-02-10T00:00:00.000Z",
  },
}

const TIMELINE: AdminEndUserTimelineEntry[] = [
  {
    id: "66666666-6666-6666-6666-666666666666",
    action: "kyc_state_change",
    actor: "admin:99999999-9999-9999-9999-999999999999",
    actorAdminId: "99999999-9999-9999-9999-999999999999",
    createdAt: "2024-02-05T00:00:00.000Z",
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

const DEVICES: AdminEndUserDevice[] = [
  {
    id: "44444444-4444-4444-4444-444444444444",
    trustState: "bound",
    isPinned: true,
    lastUsedAt: "2024-02-10T00:00:00.000Z",
    boundAt: "2024-01-05T00:00:00.000Z",
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
  mockGetEndUser.mockReset()
  mockListDevices.mockReset()
  mockListSessions.mockReset()
  mockGetLimits.mockReset()
  mockListTimeline.mockReset()
  mockListNotes.mockReset()
  mockGetKyc.mockReset()
  mockAdjustTier.mockReset()
  mockSetStatus.mockReset()
  mockForcePinReset.mockReset()
  mockRevokeDevice.mockReset()
  mockSimSwapReverify.mockReset()
  mockRequestManualCredit.mockReset()
  mockGetMe.mockReset()
  mockStepUp.mockReset()
  mockGetEndUser.mockResolvedValue(DETAIL)
  mockListDevices.mockResolvedValue(DEVICES)
  mockListSessions.mockResolvedValue(SESSIONS)
  mockGetLimits.mockResolvedValue(LIMITS)
  mockListTimeline.mockResolvedValue(TIMELINE)
  mockListNotes.mockResolvedValue({ items: [] })
  mockGetKyc.mockResolvedValue(KYC)
  mockAdjustTier.mockResolvedValue(undefined)
  mockSetStatus.mockResolvedValue(undefined)
  mockForcePinReset.mockResolvedValue(undefined)
  mockRevokeDevice.mockResolvedValue(undefined)
  mockSimSwapReverify.mockResolvedValue(undefined)
  mockRequestManualCredit.mockResolvedValue({} as never)
  mockGetMe.mockResolvedValue({ mfaEnabled: true } as never)
  mockStepUp.mockResolvedValue(undefined)
})

// Walks the design flow to completion: the ReasonModal (a reason is required to
// Continue) then the StepUpModal's six-box keypad (each digit fills a box; the sixth
// completes the step and fires the wired mutation). The server-side AdminStepUpGuard is
// the real gate — a 403 would open the StepUpDialog; here the mocked mutation resolves.
async function completeReasonAndStepUp(
  user: ReturnType<typeof userEvent.setup>,
  reason: string
) {
  await user.type(await screen.findByLabelText("Reason"), reason)
  await user.click(screen.getByRole("button", { name: "Continue" }))
  await screen.findByText("Step-up authentication")
  await user.keyboard("123456")
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("UserDetail (real data)", () => {
  it("renders the header from the resolved aggregate + KYC identity", async () => {
    renderDetail()

    // Loading first (no data yet) — the heading is absent until the query resolves.
    expect(
      screen.queryByRole("heading", { name: "Ada Lovelace" })
    ).not.toBeInTheDocument()

    // Data branch: name from KYC identity, the id chip, and the KYC status pill.
    expect(
      await screen.findByRole("heading", { name: "Ada Lovelace" })
    ).toBeInTheDocument()
    expect(screen.getByText(USER_ID)).toBeInTheDocument()
    expect(screen.getByText("Pending · tier_2")).toBeInTheDocument()
    expect(mockGetEndUser).toHaveBeenCalledWith(USER_ID)
  })

  it("shows the tokened error card with a Retry when the aggregate fails", async () => {
    mockGetEndUser.mockRejectedValue(new Error("boom"))
    renderDetail()

    expect(await screen.findByText("Failed to load user")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("renders design-consistent empty states for an aggregate with no rows", async () => {
    mockGetEndUser.mockResolvedValue({
      ...DETAIL,
      balances: [],
      beneficiaries: [],
      recentTransactions: [],
    })
    searchParams = new URLSearchParams("tab=bene")
    renderDetail()

    expect(
      await screen.findByText("No saved beneficiaries.")
    ).toBeInTheDocument()
  })

  it("deep-links to the KYC tab and shows only the last-4 of NIN, never the full value", async () => {
    searchParams = new URLSearchParams("tab=kyc")
    const { container } = renderDetail()

    // The KYC-queue deep-link lands on the KYC tab.
    expect(await screen.findByText("Identity documents")).toBeInTheDocument()

    // The masked NIN (design shows only the last-2 of the API's last-4) resolves once
    // the KYC query settles; the full NIN never appears anywhere in the DOM.
    await waitFor(() =>
      expect(screen.getByText("••• ••• ••89")).toBeInTheDocument()
    )
    expect(container.textContent).not.toContain(FULL_NIN)
    expect(container.textContent).not.toContain("23000")
  })

  it("shows the last-4 KYC identity but offers NO full-PII reveal (§3.4)", async () => {
    searchParams = new URLSearchParams("tab=kyc")
    renderDetail()

    // Last-4 mask still renders (admin keeps last-4 only).
    await waitFor(() =>
      expect(screen.getByText("••• ••• ••89")).toBeInTheDocument()
    )

    // The full-PII reveal flow is stripped: no Reveal/Hide toggle button.
    expect(
      screen.queryByRole("button", { name: /^Reveal$/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^Hide$/ })
    ).not.toBeInTheDocument()
    // The decrypted-PII banner never appears.
    expect(screen.queryByText(/decrypted pii/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/re-mask/i)).not.toBeInTheDocument()
  })

  it("offers no 'View as' header action (view-as removed)", async () => {
    renderDetail()
    await screen.findByRole("heading", { name: "Ada Lovelace" })

    expect(
      screen.queryByRole("button", { name: "View as" })
    ).not.toBeInTheDocument()
  })

  it("renders the real devices list on the Devices tab", async () => {
    searchParams = new URLSearchParams("tab=devices")
    renderDetail()

    expect(await screen.findByText("bound device")).toBeInTheDocument()
    expect(screen.getByText("Pinned")).toBeInTheDocument()
    expect(mockListDevices).toHaveBeenCalledWith(USER_ID)
  })

  it("surfaces the routing phone on the Profile tab", async () => {
    renderDetail()
    expect(await screen.findByText("+2348012345678")).toBeInTheDocument()
  })

  it("renders the admin-action timeline from the audit log on the Profile tab", async () => {
    renderDetail()

    // The audit action key renders as a humanised, capitalised label.
    expect(await screen.findByText("kyc state change")).toBeInTheDocument()
    expect(mockListTimeline).toHaveBeenCalledWith(USER_ID)
  })

  it("renders the real auth sessions on the Security tab", async () => {
    searchParams = new URLSearchParams("tab=security")
    renderDetail()

    expect(
      await screen.findByText("Mozilla/5.0 (iPhone)")
    ).toBeInTheDocument()
    expect(screen.getByText(/102\.89\.34\.19/)).toBeInTheDocument()
    expect(mockListSessions).toHaveBeenCalledWith(USER_ID)
  })

  it("renders effective limits + velocity usage on the Limits tab", async () => {
    searchParams = new URLSearchParams("tab=limits")
    renderDetail()

    // Per-tx cap formatted with the ₦ symbol + grouping from the effective caps.
    expect(await screen.findByText("₦5,000,000")).toBeInTheDocument()
    // Velocity used shows the live 24h fiat total.
    expect(screen.getByText("Daily fiat used")).toBeInTheDocument()
    expect(mockGetLimits).toHaveBeenCalledWith(USER_ID)
  })

  it("renders the real deposit addresses + transaction economics", async () => {
    searchParams = new URLSearchParams("tab=wallets")
    renderDetail()

    // The child deposit address from the aggregate renders (no longer a stub note).
    expect(await screen.findByText("TXaddr1234")).toBeInTheDocument()
  })

  it("renders the transaction amount + NGN fiat leg on the Transactions tab", async () => {
    searchParams = new URLSearchParams("tab=tx")
    renderDetail()

    // The crypto amount + the humanised NGN fiat leg (₦150,000) from metadata.
    expect(await screen.findByText("100.00")).toBeInTheDocument()
    expect(screen.getByText("₦150,000")).toBeInTheDocument()
  })
})

// ─── Phase 7 (WRITES): wired account actions ─────────────────────────────────────
// Each header/tab action now drives the reason → step-up (→ maker) flow to a REAL
// end-user mutation. Funds-safety: the flow's TOTP is POSTed to /admin/auth/step-up
// (establishing the fresh step-up the server guard requires) BEFORE the mutation; the
// user's queries re-resolve on success. No UI code moves money (§3.1).

describe("UserDetail account actions (Phase 7 writes)", () => {
  it("Freeze → reason → step-up fires setEndUserStatus(suspended)", async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByRole("heading", { name: "Ada Lovelace" })

    await user.click(screen.getByRole("button", { name: "Freeze" }))

    // The mutation must NOT fire before the reason + step-up steps complete.
    expect(mockSetStatus).not.toHaveBeenCalled()
    await completeReasonAndStepUp(user, "Fraud review")

    await waitFor(() =>
      expect(mockSetStatus).toHaveBeenCalledWith(USER_ID, {
        status: "suspended",
      })
    )
  })

  it("Unfreeze fires setEndUserStatus(active) for an already-suspended user", async () => {
    mockGetEndUser.mockResolvedValue({ ...DETAIL, status: "suspended" })
    const user = userEvent.setup()
    renderDetail()
    await screen.findByRole("heading", { name: "Ada Lovelace" })

    await user.click(screen.getByRole("button", { name: "Unfreeze" }))
    await completeReasonAndStepUp(user, "Cleared")

    await waitFor(() =>
      expect(mockSetStatus).toHaveBeenCalledWith(USER_ID, { status: "active" })
    )
  })

  it("Reset PIN → reason → step-up fires forcePinReset", async () => {
    searchParams = new URLSearchParams("tab=security")
    const user = userEvent.setup()
    renderDetail()

    await user.click(
      await screen.findByRole("button", { name: /Reset PIN directive/ })
    )
    await completeReasonAndStepUp(user, "User lockout")

    await waitFor(() => expect(mockForcePinReset).toHaveBeenCalledWith(USER_ID))
  })

  it("Override tier → reason → step-up → maker-checker fires adjustTier (de-escalated tier)", async () => {
    searchParams = new URLSearchParams("tab=kyc")
    const user = userEvent.setup()
    renderDetail()

    await user.click(
      await screen.findByRole("button", { name: /Override tier/ })
    )
    await completeReasonAndStepUp(user, "Downgrade risk")

    // Maker-checker is the final step — the mutation fires only on submit-for-approval.
    expect(mockAdjustTier).not.toHaveBeenCalled()
    await user.click(
      await screen.findByRole("button", { name: "Submit for approval" })
    )
    // The DETAIL fixture is tier_2 → override de-escalates to tier_1.
    await waitFor(() =>
      expect(mockAdjustTier).toHaveBeenCalledWith(USER_ID, { tier: "tier_1" })
    )
  })

  it("Revoke device → reason → step-up fires revokeDevice with the row's device id", async () => {
    searchParams = new URLSearchParams("tab=devices")
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole("button", { name: "Unbind" }))
    await completeReasonAndStepUp(user, "Lost device")

    await waitFor(() =>
      expect(mockRevokeDevice).toHaveBeenCalledWith(USER_ID, DEVICES[0].id)
    )
  })

  it("SIM-swap re-verify (flagged) → reason → step-up fires simSwapReverify", async () => {
    mockGetEndUser.mockResolvedValue({
      ...DETAIL,
      simSwapDetectedAt: "2024-02-01T00:00:00.000Z",
    })
    searchParams = new URLSearchParams("tab=devices")
    const user = userEvent.setup()
    renderDetail()

    await user.click(
      await screen.findByRole("button", { name: /SIM-swap re-verify/ })
    )
    await completeReasonAndStepUp(user, "SIM change confirmed")

    await waitFor(() =>
      expect(mockSimSwapReverify).toHaveBeenCalledWith(USER_ID)
    )
  })

  it("does not fire the mutation if the flow is cancelled at the reason step", async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByRole("heading", { name: "Ada Lovelace" })

    await user.click(screen.getByRole("button", { name: "Freeze" }))
    await user.click(await screen.findByRole("button", { name: "Cancel" }))

    expect(mockSetStatus).not.toHaveBeenCalled()
  })

  // Manual credit is the maker step of the engine-brokered credit: amount + asset →
  // reason → step-up → engine preview → maker-checker → POST /admin/users/:id/credit
  // (which RAISES a request; a SECOND admin's approval settles it via the engine, §3.1).
  it("Manual credit → collect amount → reason → step-up → engine → maker fires requestManualCredit", async () => {
    searchParams = new URLSearchParams("tab=wallets")
    const user = userEvent.setup()
    renderDetail()

    await user.click(
      await screen.findByRole("button", { name: "Manual credit" })
    )

    // The ManualCreditModal input step — the credit does NOT fire on amount entry.
    await user.type(await screen.findByLabelText("Credit amount"), "25.5")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(mockRequestManualCredit).not.toHaveBeenCalled()

    // reason → step-up.
    await completeReasonAndStepUp(user, "Goodwill credit")

    // Engine preview then maker-checker — the request fires ONLY on submit-for-approval.
    await user.click(
      await screen.findByRole("button", { name: "Execute via engine" })
    )
    expect(mockRequestManualCredit).not.toHaveBeenCalled()
    await user.click(
      await screen.findByRole("button", { name: "Submit for approval" })
    )

    await waitFor(() =>
      expect(mockRequestManualCredit).toHaveBeenCalledWith(USER_ID, {
        asset: "USDT",
        amount: "25.5",
        reason: "Goodwill credit",
      })
    )
  })

  it("Manual credit refuses a non-positive amount at the input step (never raises)", async () => {
    searchParams = new URLSearchParams("tab=wallets")
    const user = userEvent.setup()
    renderDetail()

    await user.click(
      await screen.findByRole("button", { name: "Manual credit" })
    )
    await user.type(await screen.findByLabelText("Credit amount"), "0")

    // The Continue CTA stays disabled for a zero amount — no flow advance, no raise.
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled()
    expect(mockRequestManualCredit).not.toHaveBeenCalled()
  })
})
