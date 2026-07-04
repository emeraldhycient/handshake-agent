/**
 * LedgerPage tests — wired to the GLOBAL cross-account ledger read via
 * `useGlobalLedger` (GET /admin/ledger/all) + the sequence-integrity summary via
 * `useLedgerIntegrity` (GET /admin/ledger/integrity). Both api clients are mocked;
 * no server.
 *
 * Unlike the old account-scoped triple, this browses ALL accounts by an optional
 * account-TYPE + currency filter and loads eagerly (no account-id gate). The tests
 * assert:
 *   1. the header integrity pill reflects the real summary (OK vs gap);
 *   2. the projected columns (Seq / Account / Dir / Amount / Running / Source link)
 *      render from the mocked `AdminLedgerEntry` rows across accounts;
 *   3. changing a filter re-queries with the right params (omitting empty filters);
 *   4. keyset "Load more" fetches the next page via the response `nextCursor`;
 *   5. an errored query surfaces the inline error + Retry affordance;
 *   6. the Export button still fires its toast stand-in (Phase 7 write path).
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminLedgerEntry } from "@handshake-agent/contracts"

import { LedgerPage } from "@/components/admin/ledger-page"
import { defaultToastStore } from "@/lib/store/toast-store"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/ledger", () => ({
  listGlobalLedger: vi.fn(),
  getLedgerIntegrity: vi.fn(),
  exportLedger: vi.fn(),
}))
vi.mock("@/lib/download", () => ({
  downloadFile: vi.fn(),
  exportFilename: (subject: string) => `${subject}-export.csv`,
}))

import {
  listGlobalLedger,
  getLedgerIntegrity,
  exportLedger,
} from "@/lib/api/ledger"
import { downloadFile } from "@/lib/download"

const mockList = vi.mocked(listGlobalLedger)
const mockIntegrity = vi.mocked(getLedgerIntegrity)
const mockExport = vi.mocked(exportLedger)
const mockDownloadFile = vi.mocked(downloadFile)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ENTRIES: AdminLedgerEntry[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    transactionId: "tx_80231",
    accountType: "user_wallet",
    accountId: "usr_10480",
    currency: "NGN",
    amount: "106469.00",
    direction: "debit",
    balanceAfter: "893531.00",
    sequence: 44920,
    postedAt: "2026-07-01T09:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    transactionId: "tx_80244",
    accountType: "treasury_reserve",
    accountId: "usdt_treasury",
    currency: "USDT",
    amount: "53.200000",
    direction: "credit",
    balanceAfter: "159.669000",
    sequence: 12,
    postedAt: "2026-07-01T09:05:00.000Z",
  },
]

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <LedgerPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
  mockList.mockReset()
  mockIntegrity.mockReset()
  mockList.mockResolvedValue({ entries: ENTRIES, nextCursor: null })
  mockIntegrity.mockResolvedValue({
    ok: true,
    accountsChecked: 12,
    brokenAccount: null,
  })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LedgerPage", () => {
  it("renders the header + a live OK integrity pill", async () => {
    renderPage()

    expect(screen.getByRole("heading", { name: "Ledger" })).toBeInTheDocument()
    expect(
      await screen.findByText("Sequence integrity OK")
    ).toBeInTheDocument()
  })

  it("shows a sequence-gap pill when the integrity summary is broken", async () => {
    mockIntegrity.mockResolvedValue({
      ok: false,
      accountsChecked: 12,
      brokenAccount: "user_wallet:usr_10480:NGN",
    })
    renderPage()

    expect(
      await screen.findByText(/Sequence gap: user_wallet:usr_10480:NGN/i)
    ).toBeInTheDocument()
  })

  it("loads global entries across accounts on mount (no account-id gate)", async () => {
    renderPage()

    await waitFor(() => expect(mockList).toHaveBeenCalled())
    // Default filters omit accountType/currency (both "All") — only limit is set.
    expect(mockList.mock.calls[0][0]).toEqual({ limit: 25 })

    // Two legs on DIFFERENT accounts render; each formats against its own currency.
    expect(
      await screen.findByText("user_wallet:usr_10480:NGN")
    ).toBeInTheDocument()
    expect(
      screen.getByText("treasury_reserve:usdt_treasury:USDT")
    ).toBeInTheDocument()
    expect(screen.getByText("₦106,469.00")).toBeInTheDocument()
    expect(screen.getByText("53.2 USDT")).toBeInTheDocument()
    expect(screen.getByText("DEBIT")).toBeInTheDocument()
    expect(screen.getByText("CREDIT")).toBeInTheDocument()
    const source = screen.getByRole("link", { name: "tx_80231" })
    expect(source).toHaveAttribute("href", "/transactions/tx_80231")
  })

  it("re-queries with the accountType filter, omitting the empty currency", async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(mockList).toHaveBeenCalled())

    await user.selectOptions(
      screen.getByLabelText("Filter by account type"),
      "treasury_reserve"
    )

    await waitFor(() => {
      const last = mockList.mock.calls.at(-1)
      expect(last?.[0]).toEqual({ accountType: "treasury_reserve", limit: 25 })
    })
  })

  it("fetches the next keyset page when Load more is clicked", async () => {
    const user = userEvent.setup()
    // First page has a nextCursor; second page ends the list.
    mockList
      .mockResolvedValueOnce({
        entries: [ENTRIES[0]],
        nextCursor: ENTRIES[0].id,
      })
      .mockResolvedValueOnce({ entries: [ENTRIES[1]], nextCursor: null })
    renderPage()

    expect(
      await screen.findByText("user_wallet:usr_10480:NGN")
    ).toBeInTheDocument()

    const loadMore = await screen.findByRole("button", { name: /Load more/i })
    await user.click(loadMore)

    // The second call carries the cursor returned by the first page.
    await waitFor(() => {
      const last = mockList.mock.calls.at(-1)
      expect(last?.[0]).toMatchObject({ cursor: ENTRIES[0].id })
    })
    expect(
      await screen.findByText("treasury_reserve:usdt_treasury:USDT")
    ).toBeInTheDocument()
  })

  it("shows an inline error with a Retry affordance when the query fails", async () => {
    mockList.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText(/Couldn.t load ledger entries/i)
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("renders an empty state when no entries match the filters", async () => {
    mockList.mockResolvedValue({ entries: [], nextCursor: null })
    renderPage()

    expect(
      await screen.findByText(/No ledger entries match these filters/i)
    ).toBeInTheDocument()
  })

  it("downloads a CSV of the ledger when Export is clicked", async () => {
    const user = userEvent.setup()
    mockExport.mockResolvedValue(new Blob(["seq,account\n"]))
    renderPage()

    await user.click(screen.getByRole("button", { name: /Export/i }))

    await waitFor(() => expect(mockExport).toHaveBeenCalledTimes(1))
    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
  })
})
