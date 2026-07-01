/**
 * TreasuryPage tests (Phase 6b — every read is live).
 *
 * The display data comes from the admin treasury hooks: `useTreasuryBalances`
 * (custodial hero), `useTreasuryFiatFloat` (NGN float tile), `useTreasuryFxPosition`
 * (FX-position tile + the derived exposure-headroom %), `useTreasuryExposure`
 * (fallback status), `useTreasuryAlerts` (warning banner), `useTreasurySweeps`
 * (child-address sweep rows + threshold), and `useTreasuryPayoutQueue` (the pending
 * payout / withdrawal approval queue). The `lib/api/treasury` client is mocked (no
 * server); the tests cover loading → data plus the empty and error branches.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminBeneficiaryListResponse,
  TreasuryAlertListResponse,
  TreasuryBalancesResponse,
  TreasuryExposureListResponse,
  TreasuryFiatFloatResponse,
  TreasuryFxPositionResponse,
  TreasuryPayoutQueueResponse,
  TreasurySweepListResponse,
} from "@handshake-agent/contracts"

import { TreasuryPage } from "@/components/admin/treasury-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/treasury", () => ({
  listTreasuryBalances: vi.fn(),
  listTreasuryExposure: vi.fn(),
  listTreasuryAlerts: vi.fn(),
  listTreasurySweeps: vi.fn(),
  listTreasuryPayoutQueue: vi.fn(),
  listTreasuryFiatFloat: vi.fn(),
  listTreasuryFxPosition: vi.fn(),
  // WRITE: acknowledge a threshold-breach alert (audited note).
  acknowledgeTreasuryAlert: vi.fn(),
  // WRITE (Phase 7): raise a maker-checker payout-release approval.
  approveTreasuryPayout: vi.fn(),
}))

// The banner's acknowledge + the cooling-off override read the signed-in admin to
// pick the step-up mode; the override lists + clears beneficiary first-use locks.
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
  stepUp: vi.fn(),
}))

vi.mock("@/lib/api/beneficiaries", () => ({
  listBeneficiaries: vi.fn(),
  overrideCoolingOff: vi.fn(),
}))

import {
  listTreasuryBalances,
  listTreasuryExposure,
  listTreasuryAlerts,
  listTreasurySweeps,
  listTreasuryPayoutQueue,
  listTreasuryFiatFloat,
  listTreasuryFxPosition,
  acknowledgeTreasuryAlert,
  approveTreasuryPayout,
} from "@/lib/api/treasury"
import { getMe } from "@/lib/api/admin"
import { listBeneficiaries, overrideCoolingOff } from "@/lib/api/beneficiaries"

const mockBalances = vi.mocked(listTreasuryBalances)
const mockExposure = vi.mocked(listTreasuryExposure)
const mockAlerts = vi.mocked(listTreasuryAlerts)
const mockSweeps = vi.mocked(listTreasurySweeps)
const mockPayouts = vi.mocked(listTreasuryPayoutQueue)
const mockFiatFloat = vi.mocked(listTreasuryFiatFloat)
const mockFx = vi.mocked(listTreasuryFxPosition)
const mockAcknowledge = vi.mocked(acknowledgeTreasuryAlert)
const mockApprovePayout = vi.mocked(approveTreasuryPayout)
const mockGetMe = vi.mocked(getMe)
const mockBeneficiaries = vi.mocked(listBeneficiaries)
const mockOverride = vi.mocked(overrideCoolingOff)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BALANCES: TreasuryBalancesResponse = {
  balances: [
    { network: "TRON", asset: "USDT", totalAmount: "412908.44", walletCount: 12 },
    { network: "TRON", asset: "TRX", totalAmount: "980.10", walletCount: 12 },
  ],
}

const EXPOSURE: TreasuryExposureListResponse = {
  items: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      asset: "USDT",
      fiatCurrency: "NGN",
      cryptoHeld: "412908.44",
      fiatEquivalent: "640000000.00",
      netExposure: "180000.00",
      exposureLimitBps: 500,
      status: "warning",
      createdAt: "2026-07-01T04:00:00.000Z",
    },
  ],
}

const ALERTS: TreasuryAlertListResponse = {
  items: [
    {
      id: "22222222-2222-2222-2222-222222222222",
      asset: "USDT",
      severity: "critical",
      message: "USDT net exposure exceeds the configured inventory limit.",
      netExposure: "180000.00",
      triggeredAt: "2026-07-01T03:59:00.000Z",
      acknowledgedAt: null,
    },
  ],
}

const SWEEPS: TreasurySweepListResponse = {
  items: [
    {
      id: "33333333-3333-3333-3333-333333333333",
      address: "TJm4Yq8s2kPd9wR3vN7xL6bH1cF0gA5eZt",
      network: "TRON",
      asset: "TRX",
      balance: "18.40",
      status: "below_threshold",
      lastSweptAt: null,
    },
  ],
  sweepThreshold: "25",
  thresholdAsset: "TRX",
}

const PAYOUTS: TreasuryPayoutQueueResponse = {
  items: [
    {
      id: "44444444-4444-4444-4444-444444444444",
      transactionId: "55555555-5555-5555-5555-555555555555",
      beneficiaryLabel: "Kelechi Chukwu · GTBank",
      reference: "wd_44219",
      method: "NGN payout · Flutterwave",
      asset: "NGN",
      amount: "4820000.00",
      fiatAmount: null,
      requiresApproval: true,
      submittedAt: "2026-07-01T03:00:00.000Z",
    },
    {
      id: "66666666-6666-6666-6666-666666666666",
      transactionId: "77777777-7777-7777-7777-777777777777",
      beneficiaryLabel: "TRON withdrawal",
      reference: "wd_44220",
      method: "USDT · Blockradar",
      asset: "USDT",
      amount: "1250.00",
      fiatAmount: null,
      requiresApproval: false,
      submittedAt: "2026-07-01T02:00:00.000Z",
    },
  ],
}

const FIAT_FLOAT: TreasuryFiatFloatResponse = {
  items: [
    {
      currency: "NGN",
      balance: "42180500.00",
      targetFloat: "234000000",
      utilizationBps: 1803,
      status: "low",
      lowFloatThresholdBps: 2500,
    },
  ],
}

const FX: TreasuryFxPositionResponse = {
  items: [
    {
      asset: "USDT",
      fiatCurrency: "NGN",
      netPositionFiat: "8240.00",
      direction: "long",
      headroomBps: 7200,
      exposureStatus: "safe",
    },
  ],
}

const ME = {
  id: "88888888-8888-8888-8888-888888888888",
  email: "ops@handshake.ng",
  role: {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Super Admin",
  },
  status: "active" as const,
  mfaEnabled: false,
  permissions: [],
  menus: [],
  pages: [],
}

// One beneficiary is still inside its first-use cooling-off window (override target);
// one is cleared (must not render an override row).
const BENEFICIARIES: AdminBeneficiaryListResponse = {
  items: [
    {
      id: "99999999-9999-9999-9999-999999999999",
      userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      type: "crypto_address",
      label: "Chidi · USDT wallet",
      verificationStatus: "verified",
      firstUseLockedUntil: "2099-01-01T00:00:00.000Z",
      coolingOffActive: true,
      createdAt: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      userId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      type: "bank_account",
      label: "Ada · GTBank",
      verificationStatus: "verified",
      firstUseLockedUntil: null,
      coolingOffActive: false,
      createdAt: "2026-06-01T00:00:00.000Z",
    },
  ],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TreasuryPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockBalances.mockReset().mockResolvedValue(BALANCES)
  mockExposure.mockReset().mockResolvedValue(EXPOSURE)
  mockAlerts.mockReset().mockResolvedValue(ALERTS)
  mockSweeps.mockReset().mockResolvedValue(SWEEPS)
  mockPayouts.mockReset().mockResolvedValue(PAYOUTS)
  mockFiatFloat.mockReset().mockResolvedValue(FIAT_FLOAT)
  mockFx.mockReset().mockResolvedValue(FX)
  mockAcknowledge.mockReset().mockResolvedValue({
    ...ALERTS.items[0],
    acknowledgedAt: "2026-07-01T05:00:00.000Z",
  })
  mockGetMe.mockReset().mockResolvedValue(ME)
  mockBeneficiaries.mockReset().mockResolvedValue(BENEFICIARIES)
  mockOverride.mockReset().mockResolvedValue(undefined)
  mockApprovePayout.mockReset().mockResolvedValue({
    payoutId: "44444444-4444-4444-4444-444444444444",
    changeRequestId: "88888888-8888-8888-8888-888888888888",
    status: "pending",
    released: false,
  })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TreasuryPage (wired)", () => {
  it("renders the header always", () => {
    renderPage()
    expect(
      screen.getByRole("heading", { name: "Treasury" })
    ).toBeInTheDocument()
  })

  it("shows a loading skeleton before the balances resolve", () => {
    renderPage()
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.queryByText("412908.44")).not.toBeInTheDocument()
  })

  it("wires the custodial hero from real aggregated balances", async () => {
    renderPage()
    expect(await screen.findByText("412908.44")).toBeInTheDocument()
    expect(screen.getByText("Custodial · USDT")).toBeInTheDocument()
    expect(screen.getByText("12 wallets · TRON")).toBeInTheDocument()
  })

  it("wires the NGN fiat-float tile with utilization + status", async () => {
    renderPage()
    expect(await screen.findByText("₦42,180,500.00")).toBeInTheDocument()
    expect(screen.getByText("NGN fiat float")).toBeInTheDocument()
    // 1803 bps → 18%; status low.
    expect(screen.getByText("18% of target · low")).toBeInTheDocument()
  })

  it("wires the FX-position tile with the signed net position + direction", async () => {
    renderPage()
    expect(await screen.findByText("₦8,240.00")).toBeInTheDocument()
    expect(screen.getByText("FX position")).toBeInTheDocument()
    expect(screen.getByText("Net long USDT vs NGN")).toBeInTheDocument()
  })

  it("renders the exposure-headroom % from the FX-position endpoint", async () => {
    renderPage()
    // 7200 bps → 72%.
    expect(await screen.findByText("72%")).toBeInTheDocument()
    expect(screen.getByText("Exposure headroom")).toBeInTheDocument()
  })

  it("surfaces the top unacknowledged alert in the warning banner", async () => {
    renderPage()
    expect(
      await screen.findByText(
        /net exposure exceeds the configured inventory limit/i
      )
    ).toBeInTheDocument()
  })

  it("wires child-address sweeps from the sweep read model", async () => {
    renderPage()
    expect(
      await screen.findByText("TJm4Yq8s2kPd9wR3vN7xL6bH1cF0gA5eZt")
    ).toBeInTheDocument()
    // Real gas balance + lifecycle label.
    expect(screen.getByText("18.40 TRX")).toBeInTheDocument()
    expect(screen.getByText("Below threshold")).toBeInTheDocument()
    // Threshold footer from the endpoint.
    expect(screen.getByText("Sweep threshold")).toBeInTheDocument()
    expect(screen.getByText("25 TRX")).toBeInTheDocument()
  })

  it("wires the payout / withdrawal approval queue from real pending payouts", async () => {
    renderPage()
    expect(
      await screen.findByText("Kelechi Chukwu · GTBank")
    ).toBeInTheDocument()
    expect(screen.getByText("₦4,820,000.00")).toBeInTheDocument()
    // requiresApproval → maker-checker tag on exactly the large payout.
    expect(screen.getByText("Maker-checker")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(2)
  })

  it("renders an empty sweeps state when the sweep feed is empty", async () => {
    mockSweeps.mockResolvedValue({
      items: [],
      sweepThreshold: "25",
      thresholdAsset: "TRX",
    })
    renderPage()
    expect(
      await screen.findByText(/No child addresses to sweep/i)
    ).toBeInTheDocument()
  })

  it("renders an empty payout queue when nothing is pending", async () => {
    mockPayouts.mockResolvedValue({ items: [] })
    renderPage()
    expect(
      await screen.findByText(/No payouts awaiting release/i)
    ).toBeInTheDocument()
  })

  it("hides the warning banner when there are no unacknowledged alerts", async () => {
    mockAlerts.mockResolvedValue({ items: [] })
    renderPage()
    await screen.findByText("412908.44")
    expect(screen.queryByText(/Exposure alert ·/i)).not.toBeInTheDocument()
  })

  it("renders the balances error branch with a retry affordance", async () => {
    mockBalances.mockRejectedValue(new Error("boom"))
    renderPage()
    expect(
      await screen.findByText(/Failed to load treasury balances/i)
    ).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Retry" }).length).toBeGreaterThan(0)
  })

  it("renders the sweeps error branch independently", async () => {
    mockSweeps.mockRejectedValue(new Error("boom"))
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/Failed to load sweeps/i)).toBeInTheDocument()
    )
  })

  it("renders the payout-queue error branch independently", async () => {
    mockPayouts.mockRejectedValue(new Error("boom"))
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/Failed to load payout queue/i)).toBeInTheDocument()
    )
  })
})

// ─── WRITE wiring (Phase 7) ───────────────────────────────────────────────────────
// Acknowledge (audited note) + cooling-off override call the REAL clients. Nothing
// here moves money (§3.1) — the ack annotates/clears an alert and the override clears
// a first-use lock; both are step-up-gated and invalidate their query.

describe("TreasuryPage (write wiring)", () => {
  it("fires acknowledgeTreasuryAlert with the audited note from the reason modal", async () => {
    const user = userEvent.setup()
    renderPage()

    // Open the banner's acknowledge → reason modal, enter a note, continue.
    await user.click(
      await screen.findByRole("button", { name: "Acknowledge" })
    )
    const reason = await screen.findByLabelText("Reason")
    await user.type(reason, "Reviewed exposure with treasury")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    await waitFor(() =>
      expect(mockAcknowledge).toHaveBeenCalledWith(
        "22222222-2222-2222-2222-222222222222",
        { note: expect.stringContaining("Reviewed exposure with treasury") }
      )
    )
  })

  it("fires approveTreasuryPayout via reason → maker-checker (raises four-eyes; no release)", async () => {
    const user = userEvent.setup()
    renderPage()

    // Open the first payout's Approve → reason modal, enter a reason, continue.
    const approveButtons = await screen.findAllByRole("button", {
      name: "Approve",
    })
    await user.click(approveButtons[0])
    await user.type(
      await screen.findByLabelText("Reason"),
      "Verified against the source order"
    )
    await user.click(screen.getByRole("button", { name: "Continue" }))
    // Maker-checker submit → the REAL approve mutation fires (raises a change request).
    await user.click(
      screen.getByRole("button", { name: /Submit for approval/i })
    )

    await waitFor(() =>
      expect(mockApprovePayout).toHaveBeenCalledWith(
        "44444444-4444-4444-4444-444444444444",
        { reason: expect.stringContaining("Verified against the source order") }
      )
    )
    // The row now reads "Requested" — the release awaits a second admin (§3.1).
    expect(await screen.findByText("Requested")).toBeInTheDocument()
  })

  it("surfaces only cooling-off beneficiaries and fires overrideCoolingOff", async () => {
    const user = userEvent.setup()
    renderPage()

    // The locked beneficiary renders in the cooling-off panel; the cleared one does not.
    expect(
      await screen.findByText("Chidi · USDT wallet")
    ).toBeInTheDocument()
    expect(screen.queryByText("Ada · GTBank")).not.toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "Override cooling-off" })
    )

    await waitFor(() =>
      expect(mockOverride).toHaveBeenCalledWith(
        "99999999-9999-9999-9999-999999999999"
      )
    )
  })

  it("hides the cooling-off panel when no beneficiary is locked", async () => {
    mockBeneficiaries.mockResolvedValue({
      items: [BENEFICIARIES.items[1]],
    })
    renderPage()

    await screen.findByText("412908.44")
    expect(
      screen.queryByText("Beneficiaries in cooling-off")
    ).not.toBeInTheDocument()
  })
})
