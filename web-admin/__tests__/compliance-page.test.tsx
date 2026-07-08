/**
 * CompliancePage + ComplianceEventDetail tests.
 *
 *  3. Disposing a flagged event calls the disposition api with the chosen status.
 *
 * The api layer is mocked — no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminMe,
  ComplianceEventDetail,
  ComplianceEventListResponse,
} from "@handshake-agent/contracts"

import { CompliancePage } from "@/components/admin/compliance-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

vi.mock("@/lib/api/compliance", () => ({
  listComplianceEvents: vi.fn(),
  getComplianceEvent: vi.fn(),
  disposeComplianceEvent: vi.fn(),
  listSanctions: vi.fn(),
  listAmlRules: vi.fn(),
  createAmlRule: vi.fn(),
  updateAmlRule: vi.fn(),
  listTravelRule: vi.fn(),
  listComplianceReports: vi.fn(),
  draftComplianceReport: vi.fn(),
  submitComplianceReport: vi.fn(),
}))

import { getMe } from "@/lib/api/admin"
import {
  listComplianceEvents,
  getComplianceEvent,
  disposeComplianceEvent,
  listTravelRule,
} from "@/lib/api/compliance"

const mockGetMe = vi.mocked(getMe)
const mockListEvents = vi.mocked(listComplianceEvents)
const mockGetEvent = vi.mocked(getComplianceEvent)
const mockDispose = vi.mocked(disposeComplianceEvent)
const mockListTravelRule = vi.mocked(listTravelRule)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ME: AdminMe = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@example.com",
  role: { id: "00000000-0000-0000-0000-0000000000aa", name: "compliance" },
  status: "active",
  displayName: "Test Admin",
  mfaEnabled: false,
  permissions: [],
  menus: [],
  pages: [],
}

const EVENTS: ComplianceEventListResponse = {
  items: [
    {
      id: "ee111111-1111-1111-1111-111111111111",
      userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      transactionId: null,
      eventType: "velocity_breach",
      severity: "high",
      status: "flagged",
      screeningProvider: "internal",
      ruleOrHit: "velocity.daily",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  nextCursor: null,
}

const EVENT_DETAIL: ComplianceEventDetail = {
  ...EVENTS.items[0],
  details: { hits: 3 },
  dispositionComment: null,
  dispositionAt: null,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CompliancePage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockGetMe.mockReset()
  mockListEvents.mockReset()
  mockGetEvent.mockReset()
  mockDispose.mockReset()
  mockGetMe.mockResolvedValue(ME)
  mockListEvents.mockResolvedValue(EVENTS)
  mockGetEvent.mockResolvedValue(EVENT_DETAIL)
  mockDispose.mockResolvedValue({ ...EVENT_DETAIL, status: "blocked" })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CompliancePage", () => {
  it("renders Travel Rule fiat equivalents in each record's OWN fiatCurrency", async () => {
    // Two captures valued in different fiats at capture time — never assumed NGN.
    mockListTravelRule.mockResolvedValue({
      items: [
        {
          id: "aa111111-1111-4111-8111-111111111111",
          transactionId: "bb111111-1111-4111-8111-111111111111",
          asset: "USDT",
          amount: "3500",
          amountFiat: "5250000",
          fiatCurrency: "NGN",
          triggeringFactor: "threshold",
          capturedAt: "2026-07-01T00:00:00.000Z",
          reportedAt: null,
        },
        {
          id: "cc111111-1111-4111-8111-111111111111",
          transactionId: "dd111111-1111-4111-8111-111111111111",
          asset: "USDT",
          amount: "1200",
          amountFiat: "18360",
          fiatCurrency: "GHS",
          triggeringFactor: "threshold",
          capturedAt: "2026-07-02T00:00:00.000Z",
          reportedAt: null,
        },
      ],
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("tab", { name: "Travel Rule" }))

    expect(await screen.findByText("₦5,250,000.00")).toBeInTheDocument()
    expect(screen.getByText("GH₵18,360.00")).toBeInTheDocument()
  })

  it("disposes a flagged event with the chosen status", async () => {
    const user = userEvent.setup()
    renderPage()

    // Open the event drawer from the queue.
    await user.click(await screen.findByText("velocity_breach"))

    // Choose a disposition status, then apply.
    const select = await screen.findByLabelText("Disposition status")
    await user.selectOptions(select, "blocked")
    await user.click(screen.getByRole("button", { name: "Apply disposition" }))

    await waitFor(() =>
      expect(mockDispose).toHaveBeenCalledWith(
        "ee111111-1111-1111-1111-111111111111",
        expect.objectContaining({ status: "blocked" })
      )
    )
  })
})
