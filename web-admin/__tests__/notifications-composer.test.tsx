/**
 * NotificationsPage (broadcast composer) — Phase 7 template-authoring WRITE wiring +
 * Phase 8 (F-mock-b) honest-audience wiring.
 *
 * The composer reads the template list for its TEMPLATE select and exposes a
 * "New template" affordance that opens the shared `TemplateEditorDialog` in create
 * mode — its Save drives POST /admin/notification-templates via `useUpsertTemplate`
 * (with a step-up retry on a 403). The api layer is mocked — no server. Nothing here
 * moves money (§3.1).
 *
 * Phase 8: the AUDIENCE select now offers exactly the real `BroadcastAudience`
 * contract cohorts (all / verified / tier_1 / lagos) — the fabricated client-side
 * reach counts + the client-side "large audience" gate are gone. The SERVER is the
 * sole authority on cohort size and whether the send defers to maker-checker (§3.5),
 * so the composer only advises that a large blast may require approval.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  BroadcastAudienceSchema,
  type NotificationTemplateListResponse,
} from "@handshake-agent/contracts"

import { NotificationsPage } from "@/components/admin/notifications-page"

vi.mock("@/lib/api/notifications", () => ({
  listNotificationTemplates: vi.fn(),
  getDeliveryLog: vi.fn(),
  upsertNotificationTemplate: vi.fn(),
  updateNotificationTemplate: vi.fn(),
  previewNotificationTemplate: vi.fn(),
  sendBroadcast: vi.fn(),
}))

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

import {
  getDeliveryLog,
  listNotificationTemplates,
} from "@/lib/api/notifications"
import { getMe } from "@/lib/api/admin"

const mockTemplates = vi.mocked(listNotificationTemplates)
const mockDeliveryLog = vi.mocked(getDeliveryLog)
const mockGetMe = vi.mocked(getMe)

const TEMPLATES: NotificationTemplateListResponse = {
  items: [
    {
      id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      templateKey: "kyc_reminder",
      language: "en",
      channel: "whatsapp",
      subject: null,
      contentText: "Reminder to finish KYC, {{name}}.",
      contentHtml: null,
      whatsappTemplateId: "wa_1",
      variables: [],
    },
  ],
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
  mockTemplates.mockReset()
  mockDeliveryLog.mockReset()
  mockGetMe.mockReset()
  mockTemplates.mockResolvedValue(TEMPLATES)
  mockDeliveryLog.mockResolvedValue({
    items: [],
    stats: { bounceRate: 0, complaintRate: 0, sampleSize: 0 },
  })
  mockGetMe.mockResolvedValue({
    id: "11111111-1111-1111-1111-111111111111",
    email: "amara@handshake.ng",
    role: { id: "00000000-0000-0000-0000-000000000001", name: "Super Admin" },
    status: "active",
    displayName: "Test Admin",
    mfaEnabled: false,
    permissions: [],
    menus: [],
    pages: [],
  })
})

describe("NotificationsPage (broadcast composer — template authoring)", () => {
  it("renders the composer and its real template options", async () => {
    renderPage()

    expect(
      screen.getByRole("heading", { name: "Notifications & comms" })
    ).toBeInTheDocument()
    // The TEMPLATE select resolves the real template key.
    expect(await screen.findByRole("option", { name: "kyc_reminder" }))
      .toBeInTheDocument()
  })

  it("offers exactly the real BroadcastAudience cohorts as audience options", () => {
    renderPage()

    const select = screen.getByRole("combobox", { name: /Broadcast audience/i })
    const options = Array.from(
      select.querySelectorAll("option")
    ) as HTMLOptionElement[]
    const values = options.map((o) => o.value)

    // The audience <option> values ARE the contract's enum cohorts — no fabricated
    // reach counts, no client-invented cohort ids.
    expect(new Set(values)).toEqual(new Set(BroadcastAudienceSchema.options))
    // Each rendered value is a valid enum member (parses without throwing).
    for (const value of values) {
      expect(() => BroadcastAudienceSchema.parse(value)).not.toThrow()
    }
    // No fabricated per-cohort reach count leaks into a label (the SERVER is the
    // sole authority on cohort size, §3.5) — the mock "(2,140)"-style counts are gone.
    for (const option of options) {
      expect(option.textContent ?? "").not.toMatch(/\(\s*[\d,]{2,}\s*\)/)
    }
  })

  it("opens the shared template editor in create mode from the New template affordance", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: /new template/i })
    )

    // The editor dialog opens in create mode (heading + empty templateKey field).
    expect(
      await screen.findByRole("heading", { name: "New template" })
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Template key")).toHaveValue("")
  })

  it("keeps the broadcast send proposal-only (a small audience never sends on click)", async () => {
    const user = userEvent.setup()
    renderPage()

    // Pressing the send CTA opens the confirm modal — it does not send inline.
    await user.click(
      await screen.findByRole("button", { name: "Send broadcast" })
    )
    expect(
      await screen.findByRole("heading", { name: "Confirm broadcast" })
    ).toBeInTheDocument()
  })
})
