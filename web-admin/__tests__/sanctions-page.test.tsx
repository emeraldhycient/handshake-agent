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
 *  4. The ongoing-monitoring switches remain CONTROLLED — clicking one genuinely flips
 *     + holds its state (`aria-checked` toggles), matching the design's soft-toggle.
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
}))

import { listSanctions, getSanctionsMonitoring } from "@/lib/api/compliance"

const mockListSanctions = vi.mocked(listSanctions)
const mockGetMonitoring = vi.mocked(getSanctionsMonitoring)

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

  it("flips a monitoring switch on click and holds the new state", async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText("cp_musa_sani")

    // "Auto-block confirmed OFAC SDN-list hits" starts OFF.
    const offToggle = screen.getByRole("switch", {
      name: "Auto-block confirmed OFAC SDN-list hits",
    })
    expect(offToggle).toHaveAttribute("aria-checked", "false")

    await user.click(offToggle)
    await waitFor(() =>
      expect(offToggle).toHaveAttribute("aria-checked", "true")
    )

    // "Re-screen all customers daily against updated lists" starts ON → toggles off.
    const onToggle = screen.getByRole("switch", {
      name: "Re-screen all customers daily against updated lists",
    })
    expect(onToggle).toHaveAttribute("aria-checked", "true")

    await user.click(onToggle)
    await waitFor(() =>
      expect(onToggle).toHaveAttribute("aria-checked", "false")
    )
  })

  it("seeds each monitoring switch from the fetched config view", async () => {
    // Flip the config: re-screen OFF, PEP alert OFF, auto-block ON.
    mockGetMonitoring.mockResolvedValue({
      reScreenDaily: false,
      screenOnOutbound: true,
      pepAlert: false,
      autoBlockOfac: true,
    })
    renderPage()

    const reScreen = await screen.findByRole("switch", {
      name: "Re-screen all customers daily against updated lists",
    })
    expect(reScreen).toHaveAttribute("aria-checked", "false")

    expect(
      screen.getByRole("switch", {
        name: "Alert on new PEP (politically exposed person) matches",
      })
    ).toHaveAttribute("aria-checked", "false")
    expect(
      screen.getByRole("switch", {
        name: "Auto-block confirmed OFAC SDN-list hits",
      })
    ).toHaveAttribute("aria-checked", "true")
  })

  it("renders a monitoring error branch with a Retry when the policy fetch fails", async () => {
    mockGetMonitoring.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText("Failed to load monitoring policy")
    ).toBeInTheDocument()
  })
})
