/**
 * UsersBulkActions wiring test (Phase 7, WRITES).
 *
 * The Users-directory bulk bar's Tag / Message actions are REAL step-up-guarded
 * writes: Tag → POST /admin/users/tags, Message → POST /admin/users/message
 * (enqueued onto the notifications outbox — never a direct send; nothing moves
 * money, §3.1). The api layer + the me/step-up hooks are mocked (no server).
 *
 * Asserted:
 *  - Tag submit calls `applyUserTags` with the selected ids + tag + reason.
 *  - Message submit calls `sendBulkMessage` with the selection + template + reason.
 *  - A large-set 422 (ADMIN_BULK_CONFIRMATION_REQUIRED) surfaces the confirm
 *    affordance instead of silently failing.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { UsersBulkActions } from "@/components/admin/users-bulk-actions"
import { ApiError } from "@/lib/api/client"

vi.mock("@/lib/api/users", () => ({
  applyUserTags: vi.fn(),
  sendBulkMessage: vi.fn(),
}))

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
  stepUp: vi.fn(),
}))

import { applyUserTags, sendBulkMessage } from "@/lib/api/users"
import { getMe, stepUp } from "@/lib/api/admin"

const mockApplyTags = vi.mocked(applyUserTags)
const mockSendMessage = vi.mocked(sendBulkMessage)
const mockGetMe = vi.mocked(getMe)
const mockStepUp = vi.mocked(stepUp)

const IDS = [
  "11111111-1111-1111-1111-111111111111",
  "22222222-2222-2222-2222-222222222222",
]

function renderActions(onDone = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    onDone,
    ...render(
      <QueryClientProvider client={client}>
        <UsersBulkActions selectedIds={IDS} onDone={onDone} />
      </QueryClientProvider>
    ),
  }
}

beforeEach(() => {
  mockApplyTags.mockReset()
  mockSendMessage.mockReset()
  mockGetMe.mockReset()
  mockStepUp.mockReset().mockResolvedValue(undefined as never)
  mockGetMe.mockResolvedValue({
    id: "99999999-9999-9999-9999-999999999999",
    email: "ops@handshake.ng",
    role: { id: "00000000-0000-0000-0000-000000000001", name: "Super Admin" },
    status: "active",
    displayName: "Test Admin",
    mfaEnabled: false,
    permissions: [],
    menus: [],
    pages: [],
  } as never)
})

describe("UsersBulkActions — Tag", () => {
  it("submits the tag for the selected ids and clears the selection", async () => {
    mockApplyTags.mockResolvedValue({ tag: "vip", requested: 2, applied: 2 })
    const { onDone } = renderActions()
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Tag" }))
    await user.type(screen.getByLabelText("Tag"), "vip")
    await user.type(screen.getByLabelText("Reason"), "review cohort")
    await user.click(screen.getByRole("button", { name: "Apply tag" }))

    await waitFor(() => expect(mockApplyTags).toHaveBeenCalledTimes(1))
    expect(mockApplyTags).toHaveBeenCalledWith({
      userIds: IDS,
      tag: "vip",
      reason: "review cohort",
    })
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it("opens step-up on a 403 and replays the tag apply after re-auth", async () => {
    // mfaEnabled → the StepUpDialog surfaces the authenticator (TOTP) path.
    mockGetMe.mockResolvedValue({
      id: "99999999-9999-9999-9999-999999999999",
      email: "ops@handshake.ng",
      role: { id: "00000000-0000-0000-0000-000000000001", name: "Super Admin" },
      status: "active",
      displayName: "Test Admin",
      mfaEnabled: true,
      permissions: [],
      menus: [],
      pages: [],
    } as never)
    // First apply 403s (ADMIN_STEP_UP_REQUIRED); the replay after re-auth succeeds.
    mockApplyTags
      .mockRejectedValueOnce(
        new ApiError("step up", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce({ tag: "vip", requested: 2, applied: 2 })
    const { onDone } = renderActions()
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Tag" }))
    await user.type(screen.getByLabelText("Tag"), "vip")
    await user.type(screen.getByLabelText("Reason"), "cohort")
    await user.click(screen.getByRole("button", { name: "Apply tag" }))

    // The step-up dialog opens after the 403; re-auth replays the tag apply.
    const totp = await screen.findByLabelText(/Authenticator code/)
    await user.type(totp, "123456")
    await user.click(screen.getByRole("button", { name: "Confirm" }))

    await waitFor(() => expect(mockStepUp).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockApplyTags).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})

describe("UsersBulkActions — Message", () => {
  it("queues the broadcast for the selected ids", async () => {
    mockSendMessage.mockResolvedValue({
      broadcastRef: "bulk_x",
      eventType: "balance_update",
      requested: 2,
      queued: 2,
    })
    renderActions()
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Message" }))
    await user.type(screen.getByLabelText("Template key"), "ops.balance_notice")
    await user.type(screen.getByLabelText("Reason"), "quarterly nudge")
    await user.click(screen.getByRole("button", { name: "Queue broadcast" }))

    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1))
    const arg = mockSendMessage.mock.calls[0][0]
    expect(arg.userIds).toEqual(IDS)
    expect(arg.templateKey).toBe("ops.balance_notice")
    expect(arg.eventType).toBe("balance_update")
    expect(arg.reason).toBe("quarterly nudge")
  })

  it("surfaces the large-set confirmation prompt on a 422", async () => {
    mockSendMessage.mockRejectedValue(
      new ApiError(
        "This broadcast is over the large-set threshold; explicit confirmation is required.",
        422,
        "ADMIN_BULK_CONFIRMATION_REQUIRED"
      )
    )
    renderActions()
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Message" }))
    await user.type(screen.getByLabelText("Template key"), "ops.balance_notice")
    await user.type(screen.getByLabelText("Reason"), "nudge")
    await user.click(screen.getByRole("button", { name: "Queue broadcast" }))

    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /large-set threshold/i
    )
  })
})
