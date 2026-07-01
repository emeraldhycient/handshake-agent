/**
 * NotificationsPage + TemplateEditorDialog tests.
 *
 *  1. The templates table renders one row per template, and the editor's Live
 *     preview panel calls `usePreviewTemplate` (the preview api) and shows the
 *     rendered text the server returns.
 *  2. A template save that 403s with ADMIN_STEP_UP_REQUIRED opens the StepUpDialog.
 *
 * The api layer is mocked — no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminMe,
  NotificationTemplateListResponse,
  NotificationTemplatePreviewResponse,
} from "@handshake-agent/contracts"

import { NotificationsPage } from "@/components/admin/notifications-page"
import { ApiError } from "@/lib/api/client"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
  stepUp: vi.fn(),
}))

vi.mock("@/lib/api/notifications", () => ({
  listNotificationTemplates: vi.fn(),
  getNotificationTemplate: vi.fn(),
  upsertNotificationTemplate: vi.fn(),
  updateNotificationTemplate: vi.fn(),
  previewNotificationTemplate: vi.fn(),
}))

import { getMe, stepUp } from "@/lib/api/admin"
import {
  listNotificationTemplates,
  upsertNotificationTemplate,
  previewNotificationTemplate,
} from "@/lib/api/notifications"

const mockGetMe = vi.mocked(getMe)
const mockStepUp = vi.mocked(stepUp)
const mockList = vi.mocked(listNotificationTemplates)
const mockUpsert = vi.mocked(upsertNotificationTemplate)
const mockPreview = vi.mocked(previewNotificationTemplate)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ME: AdminMe = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@example.com",
  role: { id: "00000000-0000-0000-0000-0000000000aa", name: "ops" },
  status: "active",
  mfaEnabled: false, // → step-up asks for a password
  permissions: [],
  menus: [],
  pages: [],
}

const TEMPLATES: NotificationTemplateListResponse = {
  items: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      templateKey: "kyc.approved",
      language: "en",
      channel: "email",
      subject: "You're verified",
      contentText: "Hi {{name}}, your KYC is approved.",
      contentHtml: null,
      whatsappTemplateId: null,
      variables: [{ name: "name", type: "string", description: "User name" }],
    },
  ],
}

const PREVIEW: NotificationTemplatePreviewResponse = {
  renderedSubject: "You're verified",
  renderedText: "Hi Ada, your KYC is approved.",
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
  mockGetMe.mockReset()
  mockStepUp.mockReset()
  mockList.mockReset()
  mockUpsert.mockReset()
  mockPreview.mockReset()
  mockGetMe.mockResolvedValue(ME)
  mockList.mockResolvedValue(TEMPLATES)
  mockPreview.mockResolvedValue(PREVIEW)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("NotificationsPage", () => {
  it("renders a row per template and previews rendered text in the editor", async () => {
    const user = userEvent.setup()
    renderPage()

    // Table row rendered.
    expect(await screen.findByText("kyc.approved")).toBeInTheDocument()

    // Open the editor for that template.
    await user.click(
      screen.getByRole("button", { name: "Edit template kyc.approved" })
    )

    // The editor is open with the live-preview panel.
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      /edit template/i
    )

    // Click Preview → calls the preview api and shows the rendered text.
    await user.click(screen.getByRole("button", { name: "Preview" }))

    await waitFor(() => expect(mockPreview).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByText("Hi Ada, your KYC is approved.")
    ).toBeInTheDocument()
  })

  it("opens the step-up dialog when a save returns ADMIN_STEP_UP_REQUIRED", async () => {
    mockUpsert.mockRejectedValueOnce(
      new ApiError("Re-auth required.", 403, "ADMIN_STEP_UP_REQUIRED")
    )

    const user = userEvent.setup()
    renderPage()

    // Wait for the list to settle before opening the editor.
    await screen.findByText("kyc.approved")

    // New template → fill the minimum required fields → Save.
    await user.click(screen.getByRole("button", { name: "New template" }))
    await user.type(screen.getByLabelText("Template key"), "test.key")
    await user.type(screen.getByLabelText("Content text"), "Hello there")
    await user.click(screen.getByRole("button", { name: "Create" }))

    // The save was attempted and the step-up dialog opened.
    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1))
    const dialog = await screen.findByText(/confirm it's you/i)
    expect(dialog).toBeInTheDocument()
    expect(await screen.findByLabelText(/^password$/i)).toBeInTheDocument()
  })
})
