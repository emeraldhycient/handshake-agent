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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminEndUserDetail,
  AdminEndUserDevice,
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
}))

vi.mock("@/lib/api/kyc", () => ({
  getKycSubmission: vi.fn(),
}))

import { getEndUser, listEndUserDevices } from "@/lib/api/users"
import { getKycSubmission } from "@/lib/api/kyc"

const mockGetEndUser = vi.mocked(getEndUser)
const mockListDevices = vi.mocked(listEndUserDevices)
const mockGetKyc = vi.mocked(getKycSubmission)

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
  createdAt: "2024-01-01T00:00:00.000Z",
  devices: [],
  balances: [
    { asset: "USDT", network: "TRON", amount: "790.500000" },
    { asset: "TRX", network: "TRON", amount: "12.000000" },
  ],
  recentTransactions: [
    {
      id: "22222222-2222-2222-2222-222222222222",
      type: "buy",
      status: "completed",
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
  mockGetKyc.mockReset()
  mockGetEndUser.mockResolvedValue(DETAIL)
  mockListDevices.mockResolvedValue(DEVICES)
  mockGetKyc.mockResolvedValue(KYC)
})

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

  it("renders the real devices list on the Devices tab", async () => {
    searchParams = new URLSearchParams("tab=devices")
    renderDetail()

    expect(await screen.findByText("bound device")).toBeInTheDocument()
    expect(screen.getByText("Pinned")).toBeInTheDocument()
    expect(mockListDevices).toHaveBeenCalledWith(USER_ID)
  })
})
