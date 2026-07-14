import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { ReceiptCard } from "./receipt-card"
import type { ReceiptCardProps } from "@/types/components"

// The raw-send "Save this recipient" dialog embeds the standard AddCryptoForm
// (add mode), which consumes useAddCryptoAddress — module-mock it the same
// way add-crypto-form.test.tsx does, no QueryClientProvider needed.
const addCryptoMutate = vi.fn()
vi.mock("@/lib/query/beneficiaries", () => ({
  useAddCryptoAddress: () => ({
    mutateAsync: addCryptoMutate,
    isPending: false,
    isError: false,
  }),
}))
vi.mock("@/lib/device", () => ({
  getDeviceFingerprint: () => "web-test-fingerprint",
}))

const baseProps: ReceiptCardProps = {
  kind: "receipt",
  title: "Purchase confirmed",
  subtitle: "USDT sent to your wallet",
  amount: "₦50,120",
  rows: [
    { label: "You received", value: "32.5 USDT" },
    { label: "Network fee", value: "₦120" },
    { label: "Rate", value: "₦1,538/USDT" },
  ],
  txRef: "TXN-20240614-8821",
  action: "buy",
  density: "mobile",
}

const rawSendProps: ReceiptCardProps = {
  kind: "receipt",
  title: "Transfer sent",
  subtitle: "Your crypto is on its way",
  amount: "- 26.00 USDT",
  rows: [
    { label: "To", value: "TQn9Y2…d3pVgk7r" },
    { label: "Date", value: "18 Jun, 2:16pm" },
  ],
  txRef: "TX · a91f…7c0e",
  action: "send",
  density: "mobile",
}

describe("ReceiptCard", () => {
  it("renders title for mobile density", () => {
    render(<ReceiptCard {...baseProps} density="mobile" />)
    expect(screen.getByText("Purchase confirmed")).toBeInTheDocument()
  })

  it("renders title for desktop density", () => {
    render(<ReceiptCard {...baseProps} density="desktop" />)
    expect(screen.getByText("Purchase confirmed")).toBeInTheDocument()
  })

  it("renders amount for mobile density", () => {
    render(<ReceiptCard {...baseProps} density="mobile" />)
    expect(screen.getByText("₦50,120")).toBeInTheDocument()
  })

  it("renders amount for desktop density", () => {
    render(<ReceiptCard {...baseProps} density="desktop" />)
    expect(screen.getByText("₦50,120")).toBeInTheDocument()
  })

  it("renders each detail row for mobile density", () => {
    render(<ReceiptCard {...baseProps} density="mobile" />)
    expect(screen.getByText("You received")).toBeInTheDocument()
    expect(screen.getByText("32.5 USDT")).toBeInTheDocument()
    expect(screen.getByText("Network fee")).toBeInTheDocument()
  })

  it("renders each detail row for desktop density", () => {
    render(<ReceiptCard {...baseProps} density="desktop" />)
    expect(screen.getByText("You received")).toBeInTheDocument()
    expect(screen.getByText("Rate")).toBeInTheDocument()
  })

  it("renders the transaction ref for mobile density", () => {
    render(<ReceiptCard {...baseProps} density="mobile" />)
    expect(screen.getByText("TXN-20240614-8821")).toBeInTheDocument()
  })

  it("renders the transaction ref for desktop density", () => {
    render(<ReceiptCard {...baseProps} density="desktop" />)
    expect(screen.getByText("TXN-20240614-8821")).toBeInTheDocument()
  })

  it("calls onShare when the Share receipt button is clicked (mobile)", async () => {
    const onShare = vi.fn()
    render(<ReceiptCard {...baseProps} density="mobile" onShare={onShare} />)
    await userEvent.click(
      screen.getByRole("button", { name: /share receipt/i })
    )
    expect(onShare).toHaveBeenCalledOnce()
  })

  // ─── Save-after-send (raw destination only) ──────────────────────────────

  describe("Save this recipient", () => {
    beforeEach(() => {
      addCryptoMutate.mockReset()
    })

    it("shows the button for a raw (unsaved) send receipt", () => {
      render(<ReceiptCard {...rawSendProps} />)
      expect(
        screen.getByRole("button", { name: /save this recipient/i })
      ).toBeInTheDocument()
    })

    it("does not show the button for a send to a saved beneficiary", () => {
      render(<ReceiptCard {...rawSendProps} beneficiaryLabel="Mum's wallet" />)
      expect(
        screen.queryByRole("button", { name: /save this recipient/i })
      ).not.toBeInTheDocument()
    })

    it("does not show the button for a non-send receipt", () => {
      render(<ReceiptCard {...baseProps} />)
      expect(
        screen.queryByRole("button", { name: /save this recipient/i })
      ).not.toBeInTheDocument()
    })

    it("opens the standard add-crypto form (PIN required) on click", async () => {
      const user = userEvent.setup()
      render(<ReceiptCard {...rawSendProps} />)

      await user.click(
        screen.getByRole("button", { name: /save this recipient/i })
      )

      expect(screen.getByLabelText("USDT address (TRON)")).toBeInTheDocument()
      expect(screen.getByLabelText("Transaction PIN")).toBeInTheDocument()
      // Not pre-filled from the receipt's masked address (§3.5) — the user
      // re-enters the full address themselves.
      expect(screen.getByLabelText("USDT address (TRON)")).toHaveValue("")
    })

    it("saving the address closes the dialog and marks the recipient saved", async () => {
      const user = userEvent.setup()
      addCryptoMutate.mockResolvedValue({ id: "crypto-ben-1" })
      render(<ReceiptCard {...rawSendProps} />)

      await user.click(
        screen.getByRole("button", { name: /save this recipient/i })
      )
      await user.type(
        screen.getByLabelText("USDT address (TRON)"),
        "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE"
      )
      await user.type(screen.getByLabelText("Label"), "Cold wallet")
      await user.type(screen.getByLabelText("Transaction PIN"), "1379")
      await user.click(screen.getByRole("button", { name: /add address/i }))

      expect(await screen.findByText("Recipient saved")).toBeInTheDocument()
      expect(screen.queryByLabelText("Transaction PIN")).not.toBeInTheDocument()
    })
  })
})
