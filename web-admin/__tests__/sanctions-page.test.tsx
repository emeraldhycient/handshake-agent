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
import type { SanctionsRecordListResponse } from "@handshake-agent/contracts"

import { SanctionsPage } from "@/components/admin/sanctions-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/compliance", () => ({
  listSanctions: vi.fn(),
}))

import { listSanctions } from "@/lib/api/compliance"

const mockListSanctions = vi.mocked(listSanctions)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SANCTIONS: SanctionsRecordListResponse = {
  items: [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      counterpartyId: "cp_musa_sani",
      verdict: "hit",
      provider: "OFAC SDN",
      screeningType: "name",
      createdAt: "2026-06-30T10:00:00.000Z",
    },
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      counterpartyId: "cp_blessing_okafor",
      verdict: "inconclusive",
      provider: "UN Security Council",
      screeningType: "address",
      createdAt: "2026-06-30T11:00:00.000Z",
    },
  ],
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
    // Provider is surfaced in the matched-list/type subtitle.
    expect(screen.getByText("OFAC SDN")).toBeInTheDocument()
    // The verdict fills the design's Score slot.
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
})
