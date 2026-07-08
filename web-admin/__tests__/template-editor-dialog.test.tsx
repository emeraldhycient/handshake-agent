/**
 * TemplateEditorDialog test — the create/edit template form. The pure body/ref/preview
 * helpers are unit-tested in `lib/notifications/template-editor.test.ts`; here we assert
 * the composed dialog: create seeds empty + POSTs, edit seeds + immutable key/lang/channel
 * + PATCHes the ref, the live preview renders, and the variables editor add/remove works.
 * The api layer is mocked (no server; no real step-up).
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { NotificationTemplate } from "@handshake-agent/contracts"

import { TemplateEditorDialog } from "@/components/admin/template-editor-dialog"
import { ApiError } from "@/lib/api/client"

vi.mock("@/lib/api/notifications", () => ({
  upsertNotificationTemplate: vi.fn(),
  updateNotificationTemplate: vi.fn(),
  previewNotificationTemplate: vi.fn(),
}))
vi.mock("@/lib/api/admin", () => ({ getMe: vi.fn(), stepUp: vi.fn() }))

import {
  upsertNotificationTemplate,
  updateNotificationTemplate,
  previewNotificationTemplate,
} from "@/lib/api/notifications"
import { getMe, stepUp } from "@/lib/api/admin"

const mockCreate = vi.mocked(upsertNotificationTemplate)
const mockUpdate = vi.mocked(updateNotificationTemplate)
const mockPreview = vi.mocked(previewNotificationTemplate)
const mockGetMe = vi.mocked(getMe)
const mockStepUp = vi.mocked(stepUp)

const TEMPLATE: NotificationTemplate = {
  id: "tpl-1",
  templateKey: "kyc_approved",
  language: "en",
  channel: "whatsapp",
  subject: null,
  contentText: "Hi {{name}}",
  contentHtml: null,
  whatsappTemplateId: null,
  variables: [],
}

function renderDialog(template: NotificationTemplate | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TemplateEditorDialog open onOpenChange={vi.fn()} template={template} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue(TEMPLATE)
  mockUpdate.mockReset().mockResolvedValue(TEMPLATE)
  mockPreview
    .mockReset()
    .mockResolvedValue({ renderedSubject: null, renderedText: "Hi Ada" })
  mockGetMe.mockReset().mockResolvedValue({
    id: "a-1",
    email: "me@x.io",
    role: { id: "r-1", name: "super_admin" },
    status: "active",
    displayName: "Me",
    mfaEnabled: true,
    permissions: [],
    menus: [],
    pages: [],
  })
  mockStepUp.mockReset().mockResolvedValue(undefined as never)
})

describe("TemplateEditorDialog", () => {
  it("creates a new template (POST with the built body, no ref)", async () => {
    const user = userEvent.setup()
    renderDialog(null)

    expect(screen.getByText("New template")).toBeInTheDocument()
    await user.type(screen.getByLabelText("Template key"), "welcome")
    // userEvent treats `{{` as an escape, so keep the sample content brace-free.
    await user.type(screen.getByLabelText("Content text"), "Hello there")
    await user.click(screen.getByRole("button", { name: "Create" }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: "welcome",
        contentText: "Hello there",
        channel: "whatsapp",
      })
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("edits an existing template (PATCH the immutable composite ref)", async () => {
    const user = userEvent.setup()
    renderDialog(TEMPLATE)

    expect(screen.getByText("Edit template")).toBeInTheDocument()
    // The composite key is immutable on edit.
    expect(screen.getByLabelText("Template key")).toBeDisabled()
    expect(screen.getByLabelText("Language")).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith(
      { templateKey: "kyc_approved", language: "en", channel: "whatsapp" },
      expect.objectContaining({ contentText: "Hi {{name}}" })
    )
  })

  it("renders a live preview from sample variables", async () => {
    const user = userEvent.setup()
    renderDialog(TEMPLATE)

    await user.click(screen.getByRole("button", { name: "Preview" }))

    await waitFor(() => expect(mockPreview).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("Hi Ada")).toBeInTheDocument()
  })

  it("adds and removes a variable row", async () => {
    const user = userEvent.setup()
    renderDialog(null)

    expect(screen.getByText("No variables documented.")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add variable" }))
    expect(screen.getByLabelText("Name")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Remove variable 1" }))
    expect(screen.getByText("No variables documented.")).toBeInTheDocument()
  })

  it("opens step-up on a 403 and replays the upsert after re-auth", async () => {
    // First save 403s (ADMIN_STEP_UP_REQUIRED); the replay after re-auth succeeds.
    mockUpdate
      .mockRejectedValueOnce(
        new ApiError("step up", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce(TEMPLATE)
    const user = userEvent.setup()
    renderDialog(TEMPLATE)

    await user.click(screen.getByRole("button", { name: "Save" }))

    // The step-up dialog opens after the 403; re-auth replays the PATCH.
    const totp = await screen.findByLabelText(/Authenticator code/)
    await user.type(totp, "123456")
    await user.click(screen.getByRole("button", { name: "Confirm" }))

    await waitFor(() => expect(mockStepUp).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2))
  })

  it("surfaces a validation error inline without firing a request", async () => {
    const user = userEvent.setup()
    renderDialog(null)

    // Create with an empty templateKey → the body fails schema validation, so the
    // error surfaces inline and no upsert request is made.
    await user.type(screen.getByLabelText("Content text"), "Body only")
    await user.click(screen.getByRole("button", { name: "Create" }))

    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
