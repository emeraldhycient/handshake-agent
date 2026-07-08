/**
 * ComplianceReportDraftDialog test — the SAR/STR draft dialog. The pure content /
 * event-id parsers are unit-tested in `lib/compliance/report-draft.test.ts`; here we
 * assert the composed dialog: invalid JSON surfaces inline without an api call, a valid
 * draft posts the parsed content + trimmed event ids, and a 403 opens step-up + replays.
 * The api layer is mocked.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ComplianceReportDraftDialog } from "@/components/admin/compliance-report-draft-dialog"
import { ApiError } from "@/lib/api/client"

vi.mock("@/lib/api/compliance", () => ({
  draftComplianceReport: vi.fn(),
}))
vi.mock("@/lib/api/admin", () => ({ getMe: vi.fn(), stepUp: vi.fn() }))

import { draftComplianceReport } from "@/lib/api/compliance"
import { getMe, stepUp } from "@/lib/api/admin"

const mockDraft = vi.mocked(draftComplianceReport)
const mockGetMe = vi.mocked(getMe)
const mockStepUp = vi.mocked(stepUp)

function renderDialog(onOpenChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ComplianceReportDraftDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>
  )
  return onOpenChange
}

beforeEach(() => {
  mockDraft.mockReset().mockResolvedValue({ id: "rep-1" } as never)
  mockStepUp.mockReset().mockResolvedValue(undefined as never)
  mockGetMe
    .mockReset()
    .mockResolvedValue({ mfaEnabled: true, permissions: [] } as never)
})

describe("ComplianceReportDraftDialog", () => {
  it("surfaces invalid JSON inline and does not call the api", async () => {
    const user = userEvent.setup()
    renderDialog()

    const content = screen.getByLabelText("Content (JSON)")
    await user.clear(content)
    await user.type(content, "not json")
    await user.click(screen.getByRole("button", { name: "Draft" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Content is not valid JSON."
    )
    expect(mockDraft).not.toHaveBeenCalled()
  })

  it("posts the parsed content + trimmed event ids, then closes", async () => {
    const user = userEvent.setup()
    const onOpenChange = renderDialog()

    await user.type(
      screen.getByLabelText("Related event ids"),
      "evt-1{Enter}evt-2"
    )
    await user.click(screen.getByRole("button", { name: "Draft" }))

    await waitFor(() =>
      expect(mockDraft).toHaveBeenCalledWith({
        reportType: "sar",
        relatedEvents: ["evt-1", "evt-2"],
        content: {},
      })
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("surfaces a non-step-up server error inline and stays open", async () => {
    mockDraft.mockRejectedValueOnce(new ApiError("boom", 500, "INTERNAL"))
    const user = userEvent.setup()
    const onOpenChange = renderDialog()

    await user.click(screen.getByRole("button", { name: "Draft" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("boom")
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("opens step-up on a 403 and replays the SAME payload after re-auth", async () => {
    mockDraft
      .mockRejectedValueOnce(
        new ApiError("step up", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce({ id: "rep-1" } as never)
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByLabelText("Related event ids"), "evt-9")
    await user.click(screen.getByRole("button", { name: "Draft" }))

    const totp = await screen.findByLabelText(/Authenticator code/)
    await user.type(totp, "123456")
    await user.click(screen.getByRole("button", { name: "Confirm" }))

    await waitFor(() => expect(mockStepUp).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockDraft).toHaveBeenCalledTimes(2))
    // The replay must carry the SAME captured payload, not stale/empty args.
    expect(mockDraft.mock.calls[1][0]).toEqual({
      reportType: "sar",
      relatedEvents: ["evt-9"],
      content: {},
    })
  })

  it("resets its fields on close + reopen (mount-only-while-open)", async () => {
    const user = userEvent.setup()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <ComplianceReportDraftDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>
    )

    const events = screen.getByLabelText("Related event ids")
    await user.type(events, "dirty-value")
    expect(events).toHaveValue("dirty-value")

    // Close, then reopen — the form body unmounts and remounts fresh.
    rerender(
      <QueryClientProvider client={client}>
        <ComplianceReportDraftDialog open={false} onOpenChange={vi.fn()} />
      </QueryClientProvider>
    )
    rerender(
      <QueryClientProvider client={client}>
        <ComplianceReportDraftDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>
    )

    expect(screen.getByLabelText("Related event ids")).toHaveValue("")
    expect(screen.getByLabelText("Content (JSON)")).toHaveValue("{}")
  })
})
