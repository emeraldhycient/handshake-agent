/**
 * SanctionsPage tests (design §6.5, Phase 6a wiring).
 *
 * The screening match cards are now data-wired via `useSanctions()` → the compliance
 * api client (mocked here — no server). These tests assert:
 *
 *  1. loading → data: the real screening records render as match cards
 *     (counterpartyId, provider/type, verdict), and the ongoing-monitoring card shows.
 *  2. empty: an empty screening-run history renders the design-consistent empty state.
 *  3. error: a failed fetch renders the tokened inline error with a Retry affordance.
 *  4. The ongoing-monitoring policy renders as READ-ONLY status pills — there is no
 *     write path for it, so a flippable switch would be a local-state lie.
 *  5. Dispositions thread the typed reason into `comment`; Escalate confirms with
 *     honest immediate copy; the real step-up is server-driven (403 → StepUpDialog).
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  SanctionsMonitoringView,
  SanctionsRecordListResponse,
} from "@handshake-agent/contracts"

import { SanctionsPage } from "@/components/admin/sanctions-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/compliance", () => ({
  listSanctions: vi.fn(),
  getSanctionsMonitoring: vi.fn(),
  disposeSanctions: vi.fn(),
}))

// The signed-in admin (drives the step-up dialog's password-vs-TOTP mode).
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

import {
  listSanctions,
  getSanctionsMonitoring,
  disposeSanctions,
} from "@/lib/api/compliance"
import { getMe } from "@/lib/api/admin"

const mockListSanctions = vi.mocked(listSanctions)
const mockGetMonitoring = vi.mocked(getSanctionsMonitoring)
const mockDispose = vi.mocked(disposeSanctions)
const mockGetMe = vi.mocked(getMe)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SANCTIONS: SanctionsRecordListResponse = {
  items: [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      counterpartyId: "cp_musa_sani",
      verdict: "hit",
      provider: "open_sanctions",
      screeningType: "transaction_counterparty",
      matchedList: "OpenSanctions",
      matchType: "Counterparty match",
      matchScore: 92,
      disposition: null,
      createdAt: "2026-06-30T10:00:00.000Z",
    },
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      counterpartyId: "cp_blessing_okafor",
      verdict: "inconclusive",
      provider: "trm",
      screeningType: "identity_verification",
      matchedList: "TRM Labs",
      matchType: "Identity match",
      matchScore: 60,
      disposition: null,
      createdAt: "2026-06-30T11:00:00.000Z",
    },
  ],
}

const MONITORING: SanctionsMonitoringView = {
  reScreenDaily: true,
  screenOnOutbound: true,
  pepAlert: true,
  autoBlockOfac: false,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SanctionsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockListSanctions.mockReset()
  mockListSanctions.mockResolvedValue(SANCTIONS)
  mockGetMonitoring.mockReset()
  mockGetMonitoring.mockResolvedValue(MONITORING)
  mockDispose.mockReset()
  mockDispose.mockResolvedValue({ ...SANCTIONS.items[0], disposition: "cleared" })
  mockGetMe.mockReset()
  mockGetMe.mockResolvedValue({
    id: "11111111-1111-1111-1111-111111111111",
    email: "amara@handshake.ng",
    role: { id: "00000000-0000-0000-0000-000000000001", name: "Super Admin" },
    status: "active",
    displayName: "Test Admin",
    mfaEnabled: true,
    permissions: [],
    menus: [],
    pages: [],
  })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SanctionsPage", () => {
  it("renders the screening matches from real data and the ongoing-monitoring card", async () => {
    renderPage()

    expect(
      screen.getByRole("heading", { name: "Sanctions & screening" })
    ).toBeInTheDocument()

    // loading → data: the mocked screening records render as match cards.
    expect(await screen.findByText("cp_musa_sani")).toBeInTheDocument()
    expect(screen.getByText("cp_blessing_okafor")).toBeInTheDocument()
    // The derived matched-list name fills the subtitle.
    expect(screen.getByText("OpenSanctions")).toBeInTheDocument()
    expect(screen.getByText("TRM Labs")).toBeInTheDocument()
    // The derived match-type label fills the subtitle (rendered in its own text
    // node after the " · " separator).
    expect(screen.getByText(/Counterparty match/)).toBeInTheDocument()
    expect(screen.getByText(/Identity match/)).toBeInTheDocument()
    // The numeric confidence score fills the design's Score slot.
    expect(screen.getByText("92")).toBeInTheDocument()
    expect(screen.getByText("60")).toBeInTheDocument()
    // The verdict label sits beneath the score.
    expect(screen.getByText("Hit")).toBeInTheDocument()

    expect(screen.getByText("Ongoing monitoring")).toBeInTheDocument()
  })

  it("renders the design-consistent empty state when there are no records", async () => {
    mockListSanctions.mockResolvedValue({ items: [] })
    renderPage()

    expect(await screen.findByText("No screening matches")).toBeInTheDocument()
    // The monitoring card still renders below the empty match list.
    expect(screen.getByText("Ongoing monitoring")).toBeInTheDocument()
  })

  it("renders a tokened inline error with a Retry affordance on failure", async () => {
    mockListSanctions.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText("Failed to load screening matches")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("renders the monitoring policy as read-only status pills (no toggle — nothing persists one)", async () => {
    renderPage()

    await screen.findByText("cp_musa_sani")
    await screen.findByText("Re-screen all customers daily against updated lists")

    // No fake switch: there is no write path for the monitoring policy, so a
    // flippable toggle would be a local-state lie. Status pills only.
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
    // Config: three flags on, auto-block off → three On pills + one Off pill.
    expect(screen.getAllByText("On")).toHaveLength(3)
    expect(screen.getAllByText("Off")).toHaveLength(1)
  })

  it("seeds each monitoring pill from the fetched config view", async () => {
    // Flip the config: re-screen OFF, PEP alert OFF, auto-block ON.
    mockGetMonitoring.mockResolvedValue({
      reScreenDaily: false,
      screenOnOutbound: true,
      pepAlert: false,
      autoBlockOfac: true,
    })
    renderPage()

    await screen.findByText("Re-screen all customers daily against updated lists")
    // Two flags on (outbound screen + auto-block), two off.
    expect(screen.getAllByText("On")).toHaveLength(2)
    expect(screen.getAllByText("Off")).toHaveLength(2)
  })

  it("renders a monitoring error branch with a Retry when the policy fetch fails", async () => {
    mockGetMonitoring.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText("Failed to load monitoring policy")
    ).toBeInTheDocument()
  })
})

describe("SanctionsPage (Phase 7 — disposition WRITE)", () => {
  it("seeds the card from the server disposition (already-disposed shows the done-label, no actions)", async () => {
    mockListSanctions.mockResolvedValue({
      items: [{ ...SANCTIONS.items[0], disposition: "blocked" }],
    })
    renderPage()

    await screen.findByText("cp_musa_sani")
    // A disposed match renders its done-label, not the Clear/Escalate/Block actions.
    expect(screen.getByText("Blocked")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Clear" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Block" })
    ).not.toBeInTheDocument()
  })

  it("does not call disposeSanctions until the reason modal's Continue fires (Clear)", async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText("cp_musa_sani")
    // Open the Clear flow — the ReasonModal appears but nothing is persisted yet.
    await user.click(screen.getAllByRole("button", { name: "Clear" })[0])
    await screen.findByRole("textbox", { name: "Reason" })
    expect(mockDispose).not.toHaveBeenCalled()
  })

  it("fires disposeSanctions with the cleared disposition through the Clear reason flow", async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText("cp_musa_sani")
    await user.click(screen.getAllByRole("button", { name: "Clear" })[0])
    await user.type(
      await screen.findByRole("textbox", { name: "Reason" }),
      "No true match"
    )
    await user.click(screen.getByRole("button", { name: "Continue" }))

    await waitFor(() => expect(mockDispose).toHaveBeenCalledTimes(1))
    // The typed reason is THREADED into the audited disposition as `comment` —
    // never silently dropped.
    expect(mockDispose).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      { disposition: "cleared", comment: "No true match" }
    )
    // The card flips to its done-label optimistically on success.
    expect(await screen.findByText("Cleared")).toBeInTheDocument()
  })

  it("fires disposeSanctions with the blocked disposition + comment through the Block reason flow", async () => {
    const user = userEvent.setup()
    mockDispose.mockResolvedValue({
      ...SANCTIONS.items[0],
      disposition: "blocked",
    })
    renderPage()

    await screen.findByText("cp_musa_sani")
    // Block → ReasonModal → disposeSanctions. The old in-flow TOTP keypad is gone:
    // the REAL step-up is server-driven (403 → StepUpDialog → replay).
    await user.click(screen.getAllByRole("button", { name: "Block" })[0])
    await user.type(
      await screen.findByRole("textbox", { name: "Reason" }),
      "OFAC SDN confirmed"
    )
    await user.click(screen.getByRole("button", { name: "Continue" }))

    await waitFor(() => expect(mockDispose).toHaveBeenCalledTimes(1))
    expect(mockDispose).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      { disposition: "blocked", comment: "OFAC SDN confirmed" }
    )
    // No decorative 6-digit keypad remains in the flow.
    expect(
      screen.queryByText("Step-up authentication")
    ).not.toBeInTheDocument()
  })

  it("escalates through an HONEST immediate confirm (a disposition applies now — no approval queue)", async () => {
    const user = userEvent.setup()
    mockDispose.mockResolvedValue({
      ...SANCTIONS.items[0],
      disposition: "escalated",
    })
    renderPage()

    await screen.findByText("cp_musa_sani")
    await user.click(screen.getAllByRole("button", { name: "Escalate" })[0])

    // The confirm modal must not claim "Pending approval" — the disposition POST
    // applies immediately (step-up-gated + audited), no change request is raised.
    const dialog = await screen.findByRole("dialog")
    expect(screen.getByText(/applies immediately/i)).toBeInTheDocument()
    expect(screen.queryByText(/pending approval/i)).not.toBeInTheDocument()
    expect(dialog).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Confirm change" }))
    await waitFor(() => expect(mockDispose).toHaveBeenCalledTimes(1))
    expect(mockDispose).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      { disposition: "escalated" }
    )
  })

  it("opens the step-up dialog and retries the POST after re-auth when the server demands step-up", async () => {
    const user = userEvent.setup()
    const { ApiError } = await import("@/lib/api/client")
    mockDispose
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce({ ...SANCTIONS.items[0], disposition: "cleared" })

    renderPage()
    await screen.findByText("cp_musa_sani")
    await user.click(screen.getAllByRole("button", { name: "Clear" })[0])
    await user.type(
      await screen.findByRole("textbox", { name: "Reason" }),
      "No true match"
    )
    await user.click(screen.getByRole("button", { name: "Continue" }))

    // The re-auth dialog appears (TOTP mode, since mfaEnabled).
    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
    expect(mockDispose).toHaveBeenCalledTimes(1)
  })
})
