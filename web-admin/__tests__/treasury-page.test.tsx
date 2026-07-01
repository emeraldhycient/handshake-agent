/**
 * TreasuryPage test.
 *
 *  4. The aggregated-balances table renders one row per network/asset group.
 *
 * The api layer is mocked — no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminMe,
  TreasuryAlertListResponse,
  TreasuryBalancesResponse,
  TreasuryExposureListResponse,
  WithdrawalPolicyListResponse,
} from "@handshake-agent/contracts"

import { TreasuryPage } from "@/components/admin/treasury-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

vi.mock("@/lib/api/treasury", () => ({
  listTreasuryBalances: vi.fn(),
  listTreasuryExposure: vi.fn(),
  listTreasuryAlerts: vi.fn(),
  acknowledgeTreasuryAlert: vi.fn(),
  listWithdrawalPolicies: vi.fn(),
}))

import { getMe } from "@/lib/api/admin"
import {
  listTreasuryBalances,
  listTreasuryExposure,
  listTreasuryAlerts,
  listWithdrawalPolicies,
} from "@/lib/api/treasury"

const mockGetMe = vi.mocked(getMe)
const mockBalances = vi.mocked(listTreasuryBalances)
const mockExposure = vi.mocked(listTreasuryExposure)
const mockAlerts = vi.mocked(listTreasuryAlerts)
const mockPolicies = vi.mocked(listWithdrawalPolicies)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ME: AdminMe = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@example.com",
  role: { id: "00000000-0000-0000-0000-0000000000aa", name: "finance" },
  status: "active",
  mfaEnabled: false,
  permissions: [],
  menus: [],
  pages: [],
}

const BALANCES: TreasuryBalancesResponse = {
  balances: [
    {
      network: "tron",
      asset: "USDT",
      totalAmount: "125000.50",
      walletCount: 42,
    },
    {
      network: "tron",
      asset: "TRX",
      totalAmount: "9000",
      walletCount: 42,
    },
  ],
}

const EMPTY_EXPOSURE: TreasuryExposureListResponse = { items: [] }
const EMPTY_ALERTS: TreasuryAlertListResponse = { items: [] }
const EMPTY_POLICIES: WithdrawalPolicyListResponse = { items: [] }

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
  mockGetMe.mockReset()
  mockBalances.mockReset()
  mockExposure.mockReset()
  mockAlerts.mockReset()
  mockPolicies.mockReset()
  mockGetMe.mockResolvedValue(ME)
  mockBalances.mockResolvedValue(BALANCES)
  mockExposure.mockResolvedValue(EMPTY_EXPOSURE)
  mockAlerts.mockResolvedValue(EMPTY_ALERTS)
  mockPolicies.mockResolvedValue(EMPTY_POLICIES)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TreasuryPage", () => {
  it("renders aggregated balance rows with totals and wallet counts", async () => {
    renderPage()

    // One card per network/asset group — the label combines asset · network.
    expect(await screen.findByText(/USDT · tron/i)).toBeInTheDocument()
    expect(screen.getByText(/TRX · tron/i)).toBeInTheDocument()
    // Total amount rendered.
    expect(screen.getByText("125000.50")).toBeInTheDocument()
    // Wallet count rendered on each of the two group cards.
    expect(screen.getAllByText(/42 wallets/i)).toHaveLength(2)
  })
})
