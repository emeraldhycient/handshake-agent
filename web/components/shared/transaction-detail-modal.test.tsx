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
      expect(screen.getByText("Receipt number")).toBeInTheDocument()
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

  it("renders the tx hash as an explorer link for a known network", async () => {
    vi.spyOn(chatApi, "getTransactionDetail").mockResolvedValue(depositDetail)

    render(
      <TransactionDetailModal
        transactionId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        onClose={vi.fn()}
      />,
      { wrapper: makeWrapper() }
    )

    await waitFor(() => expect(screen.getByText("Tx hash")).toBeInTheDocument())

    const link = screen.getByRole("link", { name: /view on explorer/i })
    expect(link).toHaveAttribute(
      "href",
      `https://tronscan.org/#/transaction/${depositDetail.txHash}`
    )
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"))
    // Copy still available alongside the link.
    expect(
      screen.getByRole("button", { name: /copy tx hash/i })
    ).toBeInTheDocument()
  })

  it("renders the tx hash as plain text (no link) for an unknown network", async () => {
    vi.spyOn(chatApi, "getTransactionDetail").mockResolvedValue({
      ...depositDetail,
      network: "ethereum",
    })

    render(
      <TransactionDetailModal
        transactionId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        onClose={vi.fn()}
      />,
      { wrapper: makeWrapper() }
    )

    await waitFor(() => expect(screen.getByText("Tx hash")).toBeInTheDocument())

    expect(
      screen.queryByRole("link", { name: /view on explorer/i })
    ).not.toBeInTheDocument()
    // Copy is still present.
    expect(
      screen.getByRole("button", { name: /copy tx hash/i })
    ).toBeInTheDocument()
  })

  it("renders internal reference rows (transaction id, provider ref) when present", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
    })
    vi.spyOn(chatApi, "getTransactionDetail").mockResolvedValue({
      ...depositDetail,
      payment: {
        accountNumber: "0123456789",
        bankName: "Test Bank",
        providerRef: "FLW-REF-999",
        amount: "19800",
        currency: "NGN",
      },
    })

    render(
      <TransactionDetailModal
        transactionId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        onClose={vi.fn()}
      />,
      { wrapper: makeWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByText("Transaction ID")).toBeInTheDocument()
    )

    // Internal transaction id row — copy carries the FULL (untruncated) id.
    const copyIdBtn = screen.getByRole("button", {
      name: /copy transaction id/i,
    })
    await user.click(copyIdBtn)
    expect(writeText).toHaveBeenCalledWith(depositDetail.id)

    // The displayed (truncated) id is excluded from translation, like the
    // tx hash and counterparty rows — it's a reference identifier, not
    // translatable prose.
    expect(screen.getByText("aaaaaaaa…aaaaaaaa")).toHaveAttribute(
      "translate",
      "no"
    )

    // Provider reference, copyable.
    expect(screen.getByText("Provider reference")).toBeInTheDocument()
    expect(screen.getByText("FLW-REF-999")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /copy provider reference/i })
    ).toBeInTheDocument()

    // The account number and provider reference values are rendered via the
    // local DetailRow (not a pre-wrapped inner span) — its value span must
    // also carry translate="no" so Google Translate never reformats a bank
    // account number or settlement reference (§3.1 funds-safety).
    expect(screen.getByText("0123456789").closest("span")).toHaveAttribute(
      "translate",
      "no"
    )
    expect(screen.getByText("FLW-REF-999").closest("span")).toHaveAttribute(
      "translate",
      "no"
    )
  })

  it("omits the provider reference row when no provider ref is present", async () => {
    // depositDetail has no payment block → no provider ref.
    vi.spyOn(chatApi, "getTransactionDetail").mockResolvedValue(depositDetail)

    render(
      <TransactionDetailModal
        transactionId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        onClose={vi.fn()}
      />,
      { wrapper: makeWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByText("Transaction ID")).toBeInTheDocument()
    )

    expect(screen.queryByText("Provider reference")).not.toBeInTheDocument()
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

describe("TransactionDetailModal — status tone (finding: FAILED is danger-red)", () => {
  async function renderWithStatus(status: TransactionStatusResponse["status"]) {
    vi.spyOn(chatApi, "getTransactionDetail").mockResolvedValue({
      ...depositDetail,
      status,
    })
    render(
      <TransactionDetailModal
        transactionId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        onClose={vi.fn()}
      />,
      { wrapper: makeWrapper() }
    )
  }

  it("renders the 'Failed' status pill on the danger palette, never neutral", async () => {
    await renderWithStatus("failed")
    const pill = await screen.findByText("Failed")
    expect(pill).toHaveClass("text-danger")
    expect(pill).toHaveClass("bg-danger-muted")
    expect(pill).not.toHaveClass("text-muted-foreground")
  })

  it("renders a 'Rolled back' status pill on the danger palette", async () => {
    await renderWithStatus("rolled_back")
    const pill = await screen.findByText("Rolled back")
    expect(pill).toHaveClass("text-danger")
    expect(pill).not.toHaveClass("text-muted-foreground")
  })

  it("keeps a completed status on the success palette", async () => {
    await renderWithStatus("completed")
    const pill = await screen.findByText("Completed")
    expect(pill).toHaveClass("text-success")
    expect(pill).not.toHaveClass("text-danger")
  })
})
