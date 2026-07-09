/**
 * AmlPage tests (Phase 6a read-wiring + Phase 7 compliance writes).
 *
 *  1. Loading → data: renders a real AML rule (name + composed threshold), a real
 *     open case (composed title), and the real Travel-Rule count — from the mocked
 *     compliance api clients.
 *  2. Open-cases filtering: terminal-status events (approved/blocked/dismissed) are
 *     excluded from the "Open cases" queue; the empty state shows.
 *  3. Error branch: when the AML-rules client rejects, the risk-rules card shows a
 *     tokened inline error with a Retry affordance.
 *  4. Compliance writes (Phase 7) — the write affordances are wired to the REAL
 *     mutation clients through the shared step-up-gated dialogs: the edit pencil
 *     updates an AML rule, "Draft SAR/CTR" drafts a report, opening a case and
 *     applying a disposition disposes the event, and a draft report can be submitted.
 *
 * The api layer is mocked — no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminMe,
  AmlRuleListResponse,
  ComplianceEventDetail,
  ComplianceEventListResponse,
  ComplianceReportListResponse,
  TravelRuleListResponse,
} from "@handshake-agent/contracts"

import { AmlPage } from "@/components/admin/aml-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

vi.mock("@/lib/api/compliance", () => ({
  listAmlRules: vi.fn(),
  createAmlRule: vi.fn(),
  updateAmlRule: vi.fn(),
  listComplianceEvents: vi.fn(),
  getComplianceEvent: vi.fn(),
  disposeComplianceEvent: vi.fn(),
  listTravelRule: vi.fn(),
  listComplianceReports: vi.fn(),
  draftComplianceReport: vi.fn(),
  submitComplianceReport: vi.fn(),
}))

import { getMe } from "@/lib/api/admin"
import {
  listAmlRules,
  updateAmlRule,
  listComplianceEvents,
  getComplianceEvent,
  disposeComplianceEvent,
  listTravelRule,
  listComplianceReports,
  draftComplianceReport,
  submitComplianceReport,
} from "@/lib/api/compliance"

const mockGetMe = vi.mocked(getMe)
const mockAmlRules = vi.mocked(listAmlRules)
const mockUpdateRule = vi.mocked(updateAmlRule)
const mockEvents = vi.mocked(listComplianceEvents)
const mockEvent = vi.mocked(getComplianceEvent)
const mockDispose = vi.mocked(disposeComplianceEvent)
const mockTravelRule = vi.mocked(listTravelRule)
const mockReports = vi.mocked(listComplianceReports)
const mockDraft = vi.mocked(draftComplianceReport)
const mockSubmit = vi.mocked(submitComplianceReport)

const ME: AdminMe = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "compliance@example.com",
  role: { id: "00000000-0000-0000-0000-0000000000aa", name: "compliance" },
  status: "active",
  displayName: "Test Admin",
  mfaEnabled: false,
  permissions: [],
  menus: [],
  pages: [],
}

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
      fiatCurrency: "NGN",
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
      fiatCurrency: "NGN",
      triggeringFactor: "amount_over_threshold",
      capturedAt: "2026-06-30T11:00:00.000Z",
      reportedAt: null,
    },
  ],
}

const REPORTS: ComplianceReportListResponse = {
  items: [
    {
      id: "rp111111-1111-1111-1111-111111111111",
      reportType: "sar",
      status: "submitted",
      relatedEvents: ["ee111111-1111-1111-1111-111111111111"],
      submittedAt: "2026-06-30T12:00:00.000Z",
      submissionRef: "NFIU-2026-0042",
      createdAt: "2026-06-30T09:00:00.000Z",
    },
    {
      id: "rp222222-2222-2222-2222-222222222222",
      reportType: "str",
      status: "draft",
      relatedEvents: [],
      submittedAt: null,
      submissionRef: null,
      createdAt: "2026-06-30T13:00:00.000Z",
    },
  ],
}

const EVENT_DETAIL: ComplianceEventDetail = {
  id: "ee111111-1111-1111-1111-111111111111",
  userId: "abcdef01-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  transactionId: null,
  eventType: "structuring_pattern",
  severity: "high",
  status: "flagged",
  screeningProvider: "internal",
  ruleOrHit: "3x sub-threshold",
  createdAt: "2026-06-30T10:00:00.000Z",
  details: { rawScore: 87, matchedList: "internal-watch" },
  dispositionComment: null,
  dispositionAt: null,
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
  mockGetMe.mockReset()
  mockAmlRules.mockReset()
  mockUpdateRule.mockReset()
  mockEvents.mockReset()
  mockEvent.mockReset()
  mockDispose.mockReset()
  mockTravelRule.mockReset()
  mockReports.mockReset()
  mockDraft.mockReset()
  mockSubmit.mockReset()
  mockGetMe.mockResolvedValue(ME)
  mockAmlRules.mockResolvedValue(AML_RULES)
  mockUpdateRule.mockResolvedValue({ ...AML_RULES.rules[0], name: "Renamed" })
  mockEvents.mockResolvedValue(EVENTS)
  mockEvent.mockResolvedValue(EVENT_DETAIL)
  mockDispose.mockResolvedValue({ ...EVENT_DETAIL, status: "blocked" })
  mockTravelRule.mockResolvedValue(TRAVEL_RULE)
  mockReports.mockResolvedValue(REPORTS)
  mockDraft.mockResolvedValue(REPORTS.items[0])
  mockSubmit.mockResolvedValue({ ...REPORTS.items[0], status: "submitted" })
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

  it("exposes a help affordance listing example AML rule types", async () => {
    const userEvent = (await import("@testing-library/user-event")).default
    const user = userEvent.setup()
    renderPage()

    const help = await screen.findByRole("button", {
      name: "Example AML rule types",
    })
    await user.click(help)

    expect(await screen.findByText("velocity_daily_limit")).toBeInTheDocument()
    expect(screen.getByText("amount_threshold")).toBeInTheDocument()
    expect(screen.getByText("sanctions_rescreen")).toBeInTheDocument()
  })

  it("renders the compliance-reports list (type, status pill, submission ref)", async () => {
    renderPage()

    // SAR report type + its regulator submission ref surface in the reports card.
    expect(await screen.findByText("sar")).toBeInTheDocument()
    expect(screen.getByText(/NFIU-2026-0042/)).toBeInTheDocument()
    // The submitted-status pill renders its label.
    expect(screen.getByText("Submitted")).toBeInTheDocument()
    expect(mockReports).toHaveBeenCalled()
  })

  it("opens the case-detail drill-in with the raw screening payload + disposition form", async () => {
    const userEvent = (await import("@testing-library/user-event")).default
    const user = userEvent.setup()
    renderPage()

    // Click the open case row → opens the disposition drawer.
    const caseRow = await screen.findByRole("button", {
      name: /Open case structuring pattern/i,
    })
    await user.click(caseRow)

    // The raw screening payload (details JSON) is surfaced.
    expect(
      await screen.findByText(/"matchedList": "internal-watch"/)
    ).toBeInTheDocument()
    // The drawer exposes the step-up-gated disposition form (Phase 7 write).
    expect(screen.getByLabelText("Disposition status")).toBeInTheDocument()
    // The detail was fetched by the drill-in.
    await waitFor(() =>
      expect(mockEvent).toHaveBeenCalledWith(
        "ee111111-1111-1111-1111-111111111111"
      )
    )
  })

  // ─── Compliance writes (Phase 7) ─────────────────────────────────────────────

  it("edits an AML rule threshold via the step-up-gated update mutation", async () => {
    const userEvent = (await import("@testing-library/user-event")).default
    const user = userEvent.setup()
    renderPage()

    // Open the edit dialog from the rule's pencil.
    await user.click(
      await screen.findByRole("button", { name: /Edit rule High velocity/i })
    )

    // Tweak the name and save → the real update client fires with the rule id.
    const nameField = await screen.findByLabelText("Name")
    await user.clear(nameField)
    await user.type(nameField, "High velocity — tuned")
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(mockUpdateRule).toHaveBeenCalledWith(
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        expect.objectContaining({ name: "High velocity — tuned" })
      )
    )
  })

  it("drafts a SAR/CTR report via the step-up-gated draft mutation", async () => {
    const userEvent = (await import("@testing-library/user-event")).default
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("button", { name: "Draft SAR/CTR" }))
    await user.click(await screen.findByRole("button", { name: "Draft" }))

    await waitFor(() =>
      expect(mockDraft).toHaveBeenCalledWith(
        expect.objectContaining({ reportType: expect.any(String) })
      )
    )
  })

  it("disposes an open case via the step-up-gated disposition mutation", async () => {
    const userEvent = (await import("@testing-library/user-event")).default
    const user = userEvent.setup()
    renderPage()

    // Open the case → the disposition drawer.
    await user.click(
      await screen.findByRole("button", {
        name: /Open case structuring pattern/i,
      })
    )

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

  it("submits a draft report via the step-up-gated submit mutation", async () => {
    const userEvent = (await import("@testing-library/user-event")).default
    const user = userEvent.setup()
    renderPage()

    // The draft report row exposes a Submit affordance (aria-label carries the
    // report type, e.g. "Submit report STR").
    await user.click(
      await screen.findByRole("button", { name: /^Submit report/i })
    )

    const refField = await screen.findByLabelText("Submission reference")
    await user.type(refField, "NFIU-2026-0099")
    await user.click(screen.getByRole("button", { name: "Submit" }))

    await waitFor(() =>
      expect(mockSubmit).toHaveBeenCalledWith(
        "rp222222-2222-2222-2222-222222222222",
        expect.objectContaining({ submissionRef: "NFIU-2026-0099" })
      )
    )
  })
})
