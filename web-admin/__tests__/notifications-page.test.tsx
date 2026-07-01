/**
 * TemplatesPage render test — WIRED to real data (Phase 6a).
 *
 * The page now renders `useNotificationTemplates()` (GET /admin/notification-templates)
 * instead of a module-level 6-card mock. The api client (`@/lib/api/notifications`)
 * is mocked (like users-page.test.tsx / metrics-dashboard.test.tsx) so no server is
 * needed.
 *
 * Asserted branches:
 *  - loading → data: skeletons give way to real template cards derived from the
 *    mocked `NotificationTemplateListResponse` (channel chip from `channel`, mono
 *    name from `templateKey`, `variables.length` vars, `contentText` body).
 *  - empty: an empty `items[]` renders the "No templates yet" state.
 *  - error: a rejected fetch renders the inline retry affordance.
 *
 * SHAPE GAP: the design's approval pill has no backing field on the contract, so it
 * is intentionally not asserted (it is omitted from the wired card).
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { NotificationTemplateListResponse } from "@handshake-agent/contracts"

import { TemplatesPage } from "@/components/admin/templates-page"

vi.mock("@/lib/api/notifications", () => ({
  listNotificationTemplates: vi.fn(),
  upsertNotificationTemplate: vi.fn(),
  updateNotificationTemplate: vi.fn(),
  previewNotificationTemplate: vi.fn(),
}))

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

import { listNotificationTemplates } from "@/lib/api/notifications"
import { getMe } from "@/lib/api/admin"

const mockList = vi.mocked(listNotificationTemplates)
const mockGetMe = vi.mocked(getMe)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RESPONSE: NotificationTemplateListResponse = {
  items: [
    {
      id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      templateKey: "kyc_verified_v2",
      language: "en",
      channel: "whatsapp",
      subject: null,
      contentText:
        "Hi {{name}}, your identity is verified. You can now buy, sell and send.",
      contentHtml: null,
      whatsappTemplateId: "wa_tmpl_1",
      variables: [
        { name: "name", type: "string", description: "User name." },
        { name: "tier", type: "string", description: "KYC tier." },
      ],
    },
    {
      id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c",
      templateKey: "tx_receipt",
      language: "en_NG",
      channel: "email",
      subject: "Your receipt",
      contentText: "Your {{type}} of {{amount}} settled on {{date}}.",
      contentHtml: null,
      whatsappTemplateId: null,
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
      <TemplatesPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockList.mockReset()
  mockGetMe.mockReset()
  mockGetMe.mockResolvedValue({
    id: "11111111-1111-1111-1111-111111111111",
    email: "amara@handshake.ng",
    role: { id: "00000000-0000-0000-0000-000000000001", name: "Super Admin" },
    status: "active",
    mfaEnabled: true,
    permissions: [],
    menus: [],
    pages: [],
  })
})

describe("TemplatesPage (wired)", () => {
  it("renders the header and channel chips from real templates (loading → data)", async () => {
    mockList.mockResolvedValue(RESPONSE)
    renderPage()

    expect(
      screen.getByRole("heading", { name: "Templates" })
    ).toBeInTheDocument()

    // Rows resolve from the mocked response.
    await screen.findByText("kyc_verified_v2")
    // Channel chips derive from the contract `channel` enum (whatsapp → WhatsApp).
    expect(screen.getByText("WhatsApp")).toBeInTheDocument()
    expect(screen.getByText("Email")).toBeInTheDocument()
  })

  it("maps contentText + variables.length + language onto the card", async () => {
    mockList.mockResolvedValue(RESPONSE)
    renderPage()

    // Body preview is the template's contentText.
    expect(
      await screen.findByText(/your identity is verified/i)
    ).toBeInTheDocument()
    // vars is variables.length; locale is language.
    expect(screen.getByText("locale en · vars: 2")).toBeInTheDocument()
    expect(screen.getByText("locale en_NG · vars: 0")).toBeInTheDocument()
  })

  it("renders the empty state when there are no templates", async () => {
    mockList.mockResolvedValue({ items: [] })
    renderPage()

    expect(await screen.findByText("No templates yet")).toBeInTheDocument()
  })

  it("renders an inline retry affordance when the fetch fails", async () => {
    mockList.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText("Couldn't load templates")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("opens the template editor to CREATE when the New template button is pressed", async () => {
    const user = userEvent.setup()
    mockList.mockResolvedValue(RESPONSE)
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: /new template/i })
    )

    // The editor dialog opens in create mode (empty templateKey field).
    expect(
      await screen.findByRole("heading", { name: "New template" })
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Template key")).toHaveValue("")
  })

  it("opens the template editor to EDIT a card, seeded with the template's fields", async () => {
    const user = userEvent.setup()
    mockList.mockResolvedValue(RESPONSE)
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: "Edit kyc_verified_v2" })
    )

    // The editor opens in edit mode, seeded from the selected template.
    expect(await screen.findByText("Edit template")).toBeInTheDocument()
    expect(screen.getByLabelText("Template key")).toHaveValue("kyc_verified_v2")
  })
})
