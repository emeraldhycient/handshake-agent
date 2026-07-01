/**
 * AmlPage tests (Phase 6a read-wiring).
 *
 *  1. Loading → data: renders a real AML rule (name + composed threshold), a real
 *     open case (composed title), and the real Travel-Rule count — from the mocked
 *     compliance api clients.
 *  2. Open-cases filtering: terminal-status events (approved/blocked/dismissed) are
 *     excluded from the "Open cases" queue; the empty state shows.
 *  3. Error branch: when the AML-rules client rejects, the risk-rules card shows a
 *     tokened inline error with a Retry affordance.
 *
 * The api layer is mocked — no server. Write affordances (edit pencil, Draft
 * SAR/CTR) are Phase 7 and are not exercised here.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AmlRuleListResponse,
  ComplianceEventListResponse,
  TravelRuleListResponse,
} from "@handshake-agent/contracts"

import { AmlPage } from "@/components/admin/aml-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/compliance", () => ({
  listAmlRules: vi.fn(),
  listComplianceEvents: vi.fn(),
  listTravelRule: vi.fn(),
}))

import {
  listAmlRules,
  listComplianceEvents,
  listTravelRule,
} from "@/lib/api/compliance"

const mockAmlRules = vi.mocked(listAmlRules)
const mockEvents = vi.mocked(listComplianceEvents)
const mockTravelRule = vi.mocked(listTravelRule)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const AML_RULES: AmlRuleListResponse = {
  rules: [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      ruleKey: "velocity.daily",
      name: "High velocity — 24h",
      description: "Flag when a user exceeds transfers/day",
      enabled: true,
      ruleType: "velocity_count",
      action: "flag",
      parameters: { max_count: 12, window_hours: 24 },
      version: 3,
    },
  ],
}

const EVENTS: ComplianceEventListResponse = {
  items: [
    {
      id: "ee111111-1111-1111-1111-111111111111",
      userId: "abcdef01-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      transactionId: null,
      eventType: "structuring_pattern",
      severity: "high",
      status: "flagged",
      screeningProvider: "internal",
      ruleOrHit: "3x sub-threshold",
      createdAt: "2026-06-30T10:00:00.000Z",
    },
    {
      id: "ee222222-2222-2222-2222-222222222222",
      userId: "abcdef02-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      transactionId: null,
      eventType: "resolved_case",
      severity: "low",
      status: "approved",
      screeningProvider: "internal",
      ruleOrHit: null,
      createdAt: "2026-06-29T10:00:00.000Z",
    },
  ],
  nextCursor: null,
}

const TRAVEL_RULE: TravelRuleListResponse = {
  items: [
    {
      id: "tr111111-1111-1111-1111-111111111111",
      transactionId: "txn_1",
      asset: "USDT",
      amount: "1500",
      amountFiat: "1500.00",
      triggeringFactor: "amount_over_threshold",
      capturedAt: "2026-06-30T10:00:00.000Z",
      reportedAt: null,
    },
    {
      id: "tr222222-2222-2222-2222-222222222222",
      transactionId: "txn_2",
      asset: "USDT",
      amount: "2200",
      amountFiat: "2200.00",
      triggeringFactor: "amount_over_threshold",
      capturedAt: "2026-06-30T11:00:00.000Z",
      reportedAt: null,
    },
  ],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AmlPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockAmlRules.mockReset()
  mockEvents.mockReset()
  mockTravelRule.mockReset()
  mockAmlRules.mockResolvedValue(AML_RULES)
  mockEvents.mockResolvedValue(EVENTS)
  mockTravelRule.mockResolvedValue(TRAVEL_RULE)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AmlPage", () => {
  it("renders real rules, open cases, and the travel-rule count (loading → data)", async () => {
    renderPage()

    // Risk rule name + a threshold composed from the rule's typed parameters.
    expect(await screen.findByText("High velocity — 24h")).toBeInTheDocument()
    expect(screen.getByText(/max count 12/)).toBeInTheDocument()

    // Open case: title composed from eventType + ruleOrHit.
    expect(
      screen.getByText("structuring pattern — 3x sub-threshold")
    ).toBeInTheDocument()

    // Travel-Rule count reflects the two real qualifying transfers.
    expect(screen.getByText("2")).toBeInTheDocument()
    expect(screen.getByText(/qualifying transfers/)).toBeInTheDocument()
  })

  it("excludes terminal-status events from the open-cases queue", async () => {
    // Only the flagged event is open; the approved one must not appear.
    renderPage()

    expect(
      await screen.findByText("structuring pattern — 3x sub-threshold")
    ).toBeInTheDocument()
    expect(screen.queryByText("resolved case")).not.toBeInTheDocument()
  })

  it("shows an empty state when there are no open cases", async () => {
    mockEvents.mockResolvedValue({ items: [], nextCursor: null })
    renderPage()

    expect(await screen.findByText("No open cases.")).toBeInTheDocument()
  })

  it("shows a tokened inline error with retry when risk rules fail to load", async () => {
    mockAmlRules.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText("Couldn't load risk rules.")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })
})
