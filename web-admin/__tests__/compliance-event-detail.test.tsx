/**
 * ComplianceEventDetail test — the flagged-event drawer. The pure format/severity/input
 * helpers are unit-tested in `lib/compliance/event-detail.test.ts`; here we assert the
 * composed drawer: it renders the event metadata + payload, applies a disposition through
 * the step-up gate (with the built input), and replays on a 403. The api layer is mocked.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ComplianceEventDetail as ComplianceEventDetailData } from "@handshake-agent/contracts"

import { ComplianceEventDetail } from "@/components/admin/compliance-event-detail"
import { ApiError } from "@/lib/api/client"

vi.mock("@/lib/api/compliance", () => ({
  getComplianceEvent: vi.fn(),
  disposeComplianceEvent: vi.fn(),
}))
vi.mock("@/lib/api/admin", () => ({ getMe: vi.fn(), stepUp: vi.fn() }))

import {
  getComplianceEvent,
  disposeComplianceEvent,
} from "@/lib/api/compliance"
import { getMe, stepUp } from "@/lib/api/admin"

const mockGet = vi.mocked(getComplianceEvent)
const mockDispose = vi.mocked(disposeComplianceEvent)
const mockGetMe = vi.mocked(getMe)
const mockStepUp = vi.mocked(stepUp)

const EVENT: ComplianceEventDetailData = {
  id: "evt-1",
  userId: "user-1",
  transactionId: "tx-1",
  eventType: "sanctions_hit",
  severity: "high",
  status: "flagged",
  screeningProvider: "chainalysis",
  ruleOrHit: "OFAC SDN",
  createdAt: "2026-07-04T00:00:00.000Z",
  details: { match: "x" },
  dispositionComment: null,
  dispositionAt: null,
}

function renderDrawer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ComplianceEventDetail eventId="evt-1" onOpenChange={vi.fn()} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockGet.mockReset().mockResolvedValue(EVENT)
  mockDispose.mockReset().mockResolvedValue({ ...EVENT, status: "approved" })
  mockStepUp.mockReset().mockResolvedValue(undefined as never)
  mockGetMe
    .mockReset()
    .mockResolvedValue({ mfaEnabled: true, permissions: [] } as never)
})

describe("ComplianceEventDetail", () => {
  it("renders the event metadata + provider", async () => {
    renderDrawer()
    expect(await screen.findByText("chainalysis")).toBeInTheDocument()
    expect(screen.getByText("OFAC SDN")).toBeInTheDocument()
    expect(screen.getByText("high")).toBeInTheDocument()
  })

  it("applies a disposition through the step-up gate (with the built input)", async () => {
    const user = userEvent.setup()
    renderDrawer()
    await screen.findByText("chainalysis")

    await user.selectOptions(
      screen.getByLabelText("Disposition status"),
      "blocked"
    )
    await user.type(screen.getByLabelText("Comment"), "  sanctions confirmed  ")
    await user.click(screen.getByRole("button", { name: "Apply disposition" }))

    await waitFor(() => expect(mockDispose).toHaveBeenCalledTimes(1))
    expect(mockDispose).toHaveBeenCalledWith("evt-1", {
      status: "blocked",
      comment: "sanctions confirmed",
    })
  })

  it("opens step-up on a 403 and replays the disposition after re-auth", async () => {
    mockDispose
      .mockRejectedValueOnce(
        new ApiError("step up", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce({ ...EVENT, status: "approved" })
    const user = userEvent.setup()
    renderDrawer()
    await screen.findByText("chainalysis")

    await user.click(screen.getByRole("button", { name: "Apply disposition" }))

    const totp = await screen.findByLabelText(/Authenticator code/)
    await user.type(totp, "123456")
    await user.click(screen.getByRole("button", { name: "Confirm" }))

    await waitFor(() => expect(mockStepUp).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockDispose).toHaveBeenCalledTimes(2))
  })
})
