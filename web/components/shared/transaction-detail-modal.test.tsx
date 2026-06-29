/**
 * Tests for TransactionDetailModal.
 *
 * TDD: written before implementation. Covers:
 *  - loading state renders skeletons
 *  - error state renders error message
 *  - data state renders all detail fields (amount, asset, network, txHash,
 *    block, confirmations, direction, fees, counterparty, status, date)
 *  - copy button is present for tx hash and counterparty
 *  - modal is closed when onClose is called via the Dialog
 *  - modal does not render when transactionId is null (no fetch)
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, afterEach } from "vitest"
import { TransactionDetailModal } from "./transaction-detail-modal"
import * as chatApi from "@/lib/api/chat"
import type { TransactionStatusResponse } from "@handshake-agent/contracts"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return Wrapper
}

const depositDetail: TransactionStatusResponse = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  type: "deposit",
  status: "completed",
  direction: "in",
  asset: "USDT",
  network: "tron",
  cryptoAmount: "12.00",
  fiatAmount: "19800",
  fiatCurrency: "NGN",
  txHash: "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
  blockNumber: 68_421_042,
  confirmations: 21,
  counterparty: "TQn9YgkXgk7rSomeLongAddress",
  fees: "0.00 USDT",
  receiptNumber: "HS-2026-000042",
  createdAt: "2026-06-29T10:00:00.000Z",
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TransactionDetailModal", () => {
  it("does not open when transactionId is null", () => {
    render(<TransactionDetailModal transactionId={null} onClose={vi.fn()} />, {
      wrapper: makeWrapper(),
    })
    // Dialog is closed — no loading or content
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("shows loading skeletons while the detail is being fetched", () => {
    // getTransactionDetail never resolves → stays loading
    vi.spyOn(chatApi, "getTransactionDetail").mockReturnValue(
      new Promise(() => {})
    )

    render(
      <TransactionDetailModal
        transactionId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        onClose={vi.fn()}
      />,
      { wrapper: makeWrapper() }
    )

    // Skeleton elements are present (radix dialog renders the content)
    const skeletons = document.querySelectorAll("[data-slot='skeleton']")
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it("shows an error state when the fetch fails", async () => {
    vi.spyOn(chatApi, "getTransactionDetail").mockRejectedValue(
      new Error("Network error")
    )

    render(
      <TransactionDetailModal
        transactionId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        onClose={vi.fn()}
      />,
      { wrapper: makeWrapper() }
    )

    await waitFor(() => {
      expect(screen.getByText("Could not load transaction")).toBeInTheDocument()
    })
  })

  it("renders core amount and asset fields from a deposit", async () => {
    vi.spyOn(chatApi, "getTransactionDetail").mockResolvedValue(depositDetail)

    render(
      <TransactionDetailModal
        transactionId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        onClose={vi.fn()}
      />,
      { wrapper: makeWrapper() }
    )

    await waitFor(() => {
      expect(screen.getByText("Deposit Detail")).toBeInTheDocument()
    })

    // Amount row
    expect(screen.getByText("12.00 USDT")).toBeInTheDocument()
    // Network
    expect(screen.getByText("TRON")).toBeInTheDocument()
    // Direction
    expect(screen.getByText("Inbound")).toBeInTheDocument()
    // Fees
    expect(screen.getByText("0.00 USDT")).toBeInTheDocument()
    // Status pill
    expect(screen.getByText("Completed")).toBeInTheDocument()
  })

  it("renders tx hash (truncated) with a copy button", async () => {
    vi.spyOn(chatApi, "getTransactionDetail").mockResolvedValue(depositDetail)

    render(
      <TransactionDetailModal
        transactionId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        onClose={vi.fn()}
      />,
      { wrapper: makeWrapper() }
    )

    await waitFor(() => {
      expect(screen.getByText("Tx hash")).toBeInTheDocument()
    })

    // The copy button for the tx hash is labeled
    const copyButton = screen.getByRole("button", { name: /copy tx hash/i })
    expect(copyButton).toBeInTheDocument()
  })

  it("renders block number and confirmation count", async () => {
    vi.spyOn(chatApi, "getTransactionDetail").mockResolvedValue(depositDetail)

    render(
      <TransactionDetailModal
        transactionId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        onClose={vi.fn()}
      />,
      { wrapper: makeWrapper() }
    )

    await waitFor(() => {
      // Block label
      expect(screen.getByText("Block")).toBeInTheDocument()
      // Confirmations label
      expect(screen.getByText("Confirmations")).toBeInTheDocument()
      // Confirmation count value
      expect(screen.getByText("21")).toBeInTheDocument()
    })
  })

  it("renders counterparty address with copy button", async () => {
    vi.spyOn(chatApi, "getTransactionDetail").mockResolvedValue(depositDetail)

    render(
      <TransactionDetailModal
        transactionId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        onClose={vi.fn()}
      />,
      { wrapper: makeWrapper() }
    )

    await waitFor(() => {
      // Label for inbound counterparty
      expect(screen.getByText("From")).toBeInTheDocument()
    })

    const copyBtn = screen.getByRole("button", { name: /copy from/i })
    expect(copyBtn).toBeInTheDocument()
  })

  it("renders receipt number with copy button", async () => {
    vi.spyOn(chatApi, "getTransactionDetail").mockResolvedValue(depositDetail)

    render(
      <TransactionDetailModal
        transactionId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        onClose={vi.fn()}
      />,
      { wrapper: makeWrapper() }
    )

    await waitFor(() => {
      expect(screen.getByText("Receipt")).toBeInTheDocument()
      expect(screen.getByText("HS-2026-000042")).toBeInTheDocument()
    })
  })

  it("shows 'To' label for outbound send transactions", async () => {
    const sendDetail: TransactionStatusResponse = {
      ...depositDetail,
      type: "send",
      direction: "out",
    }
    vi.spyOn(chatApi, "getTransactionDetail").mockResolvedValue(sendDetail)

    render(
      <TransactionDetailModal
        transactionId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        onClose={vi.fn()}
      />,
      { wrapper: makeWrapper() }
    )

    await waitFor(() => {
      expect(screen.getByText("Outbound")).toBeInTheDocument()
      expect(screen.getByText("To")).toBeInTheDocument()
    })
  })

  it("copies the tx hash to clipboard when the copy button is clicked", async () => {
    const user = userEvent.setup()
    vi.spyOn(chatApi, "getTransactionDetail").mockResolvedValue(depositDetail)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
    })

    render(
      <TransactionDetailModal
        transactionId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        onClose={vi.fn()}
      />,
      { wrapper: makeWrapper() }
    )

    await waitFor(() => expect(screen.getByText("Tx hash")).toBeInTheDocument())

    const copyButton = screen.getByRole("button", { name: /copy tx hash/i })
    await user.click(copyButton)

    expect(writeText).toHaveBeenCalledWith(depositDetail.txHash)
  })
})
