import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { KycSummary } from "./kyc-summary"

describe("KycSummary", () => {
  it("renders the main heading", () => {
    render(<KycSummary onFinish={vi.fn()} />)
    expect(
      screen.getByRole("heading", { name: /let's verify it's you/i })
    ).toBeInTheDocument()
  })

  it("renders the Phone number row with Verified pill", () => {
    render(<KycSummary onFinish={vi.fn()} />)
    expect(screen.getByText("Phone number")).toBeInTheDocument()
    expect(screen.getByText("+234 802 •••• 1123")).toBeInTheDocument()
    expect(screen.getByText("Verified")).toBeInTheDocument()
  })

  it("renders the BVN / NIN row with Matched pill", () => {
    render(<KycSummary onFinish={vi.fn()} />)
    expect(screen.getByText("BVN / NIN")).toBeInTheDocument()
    expect(screen.getByText("••• ••• ••91")).toBeInTheDocument()
    expect(screen.getByText("Matched")).toBeInTheDocument()
  })

  it("renders the Liveness selfie row with Done pill", () => {
    render(<KycSummary onFinish={vi.fn()} />)
    expect(screen.getByText("Liveness selfie")).toBeInTheDocument()
    expect(screen.getByText("Face captured")).toBeInTheDocument()
    expect(screen.getByText("Done")).toBeInTheDocument()
  })

  it("renders the Finish CTA button", () => {
    render(<KycSummary onFinish={vi.fn()} />)
    expect(
      screen.getByRole("button", { name: /finish & open my wallet/i })
    ).toBeInTheDocument()
  })

  it("calls onFinish when the CTA button is clicked", async () => {
    const onFinish = vi.fn()
    const user = userEvent.setup()
    render(<KycSummary onFinish={onFinish} />)
    await user.click(
      screen.getByRole("button", { name: /finish & open my wallet/i })
    )
    expect(onFinish).toHaveBeenCalledOnce()
  })
})
