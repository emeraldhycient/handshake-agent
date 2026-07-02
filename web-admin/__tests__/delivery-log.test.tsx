/**
 * NotificationsPage delivery-log render test — WIRED to real data (Phase 6b, Comms
 * READ enrichment).
 *
 * The delivery-log card now renders `useDeliveryLog()`
 * (GET /admin/notifications/delivery-log) instead of a module-level `DELIVERY_ROWS`
 * mock, and its footnote shows the real aggregate bounce/complaint rates. The api
 * client (`@/lib/api/notifications`) is mocked so no server is needed.
 *
 * Asserted branches:
 *  - loading → data: skeletons give way to real rows (template name from
 *    `templateKey`, event label from `eventType`, status pill from `status`), and
 *    the footnote renders the computed bounce/complaint percentages.
 *  - null templateKey falls back to the humanized event as the row name.
 *  - empty: an empty `items[]` renders the "No deliveries yet" state.
 *  - error: a rejected fetch renders the inline retry affordance.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { DeliveryLogResponse } from "@handshake-agent/contracts"

import { NotificationsPage } from "@/components/admin/notifications-page"

// The broadcast composer also fetches the template list — stub both clients so the
// page renders without a server.
vi.mock("@/lib/api/notifications", () => ({
  listNotificationTemplates: vi.fn(),
  getDeliveryLog: vi.fn(),
}))

import {
  getDeliveryLog,
  listNotificationTemplates,
} from "@/lib/api/notifications"

const mockDeliveryLog = vi.mocked(getDeliveryLog)
const mockTemplates = vi.mocked(listNotificationTemplates)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RESPONSE: DeliveryLogResponse = {
  items: [
    {
      id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      channel: "whatsapp",
      templateKey: "kyc_reminder",
      eventType: "kyc_pending_review",
      createdAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      status: "delivered",
    },
    {
      id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c",
      channel: "email",
      templateKey: null,
      eventType: "transaction_completed",
      createdAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
      status: "bounced",
    },
  ],
  stats: { bounceRate: 0.004, complaintRate: 0.0002, sampleSize: 500 },
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <NotificationsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockDeliveryLog.mockReset()
  // The composer's template list is not under test here — resolve it empty.
  mockTemplates.mockResolvedValue({ items: [] })
})

describe("NotificationsPage — delivery log (wired)", () => {
  it("renders real delivery rows (name, event, status) from the mocked response", async () => {
    mockDeliveryLog.mockResolvedValue(RESPONSE)
    renderPage()

    // Status pill derives from the contract status enum (delivered → Delivered);
    // this text is unique to a delivery row (not present in the composer).
    expect(await screen.findByText("Delivered")).toBeInTheDocument()
    expect(screen.getByText("Bounced")).toBeInTheDocument()
    // The channel chip derives from the contract enum (whatsapp → WhatsApp).
    expect(screen.getByText("WhatsApp")).toBeInTheDocument()
    // The template key is the bold row name (kyc_reminder also appears as a
    // composer fallback option, so assert at least one occurrence).
    expect(screen.getAllByText("kyc_reminder").length).toBeGreaterThan(0)
  })

  it("falls back to the humanized event as the row name when templateKey is null", async () => {
    mockDeliveryLog.mockResolvedValue(RESPONSE)
    renderPage()

    // The second row has no templateKey → its name is the humanized event type.
    expect(await screen.findByText("Transaction completed")).toBeInTheDocument()
  })

  it("renders the real bounce/complaint footnote from the aggregate stats", async () => {
    mockDeliveryLog.mockResolvedValue(RESPONSE)
    renderPage()

    // 0.004 → 0.4%, 0.0002 → 0.02%.
    expect(
      await screen.findByText(
        "bounce 0.4% · complaint 0.02% (Resend + WhatsApp)"
      )
    ).toBeInTheDocument()
  })

  it("renders the empty state when there are no deliveries", async () => {
    mockDeliveryLog.mockResolvedValue({
      items: [],
      stats: { bounceRate: 0, complaintRate: 0, sampleSize: 0 },
    })
    renderPage()

    expect(await screen.findByText("No deliveries yet")).toBeInTheDocument()
  })

  it("renders an inline retry affordance when the fetch fails", async () => {
    mockDeliveryLog.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText("Couldn't load the delivery log")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })
})
