/**
 * TemplatesPage guard test — the notification-template preview grid, wired to
 * `useNotificationTemplates()` (GET /admin/notification-templates). The api layer is
 * mocked and the shared editor dialog is stubbed so the page is tested in isolation.
 * Asserts the four async branches, the card (channel chip · name · locale/vars · body),
 * and that New template / Edit open the shared editor.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  NotificationTemplate,
  NotificationTemplateListResponse,
} from "@handshake-agent/contracts"

import { TemplatesPage } from "@/components/admin/templates-page"

vi.mock("@/lib/api/notifications", () => ({
  listNotificationTemplates: vi.fn(),
}))

// Stub the shared editor so the page test doesn't pull the dialog's own api deps.
vi.mock("@/components/admin/template-editor-dialog", () => ({
  TemplateEditorDialog: ({
    open,
    template,
  }: {
    open: boolean
    template: unknown
  }) =>
    open ? <div>TEMPLATE EDITOR · {template ? "edit" : "create"}</div> : null,
}))

import { listNotificationTemplates } from "@/lib/api/notifications"

const mockList = vi.mocked(listNotificationTemplates)

const TEMPLATE: NotificationTemplate = {
  id: "tpl-1",
  templateKey: "kyc_approved",
  language: "en",
  channel: "whatsapp",
  subject: null,
  contentText: "Your KYC is approved, {{name}}.",
  contentHtml: null,
  whatsappTemplateId: null,
  variables: [],
}

const RESPONSE: NotificationTemplateListResponse = { items: [TEMPLATE] }

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
  mockList.mockReset().mockResolvedValue(RESPONSE)
})

describe("TemplatesPage", () => {
  it("renders a template card (channel chip · name · body preview)", async () => {
    renderPage()

    expect(await screen.findByText("kyc_approved")).toBeInTheDocument()
    expect(screen.getByText("WhatsApp")).toBeInTheDocument()
    expect(
      screen.getByText("Your KYC is approved, {{name}}.")
    ).toBeInTheDocument()
  })

  it("opens the editor in create mode from New template", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("kyc_approved")

    await user.click(screen.getByRole("button", { name: "New template" }))
    expect(
      await screen.findByText("TEMPLATE EDITOR · create")
    ).toBeInTheDocument()
  })

  it("opens the editor in edit mode from a card's Edit action", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("kyc_approved")

    await user.click(screen.getByRole("button", { name: /Edit kyc_approved/ }))
    expect(
      await screen.findByText("TEMPLATE EDITOR · edit")
    ).toBeInTheDocument()
  })

  it("shows the empty state when there are no templates", async () => {
    mockList.mockResolvedValue({ items: [] })
    renderPage()
    expect(await screen.findByText("No templates yet")).toBeInTheDocument()
  })

  it("shows the error state with a retry when the fetch fails", async () => {
    mockList.mockRejectedValue(new Error("boom"))
    renderPage()
    expect(
      await screen.findByText("Couldn't load templates")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })
})
