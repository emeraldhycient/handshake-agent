import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TransactionsCard } from "./transactions-card"

const base = {
  kind: "transactions" as const,
  windowLabel: "This month",
  totalCount: 1,
  truncated: false,
  downloadUrl:
    "https://api.example.com/transactions/statement/download?token=tok",
  density: "mobile" as const,
}

describe("TransactionsCard", () => {
  it("renders rows and a download link", () => {
    render(
      <TransactionsCard
        {...base}
        rows={[
          {
            id: "t1",
            type: "buy",
            status: "completed",
            direction: "in",
            amount: "+29.97 USDT",
            sub: "2026-06-10",
          },
        ]}
      />
    )
    expect(screen.getByText("+29.97 USDT")).toBeInTheDocument()
    const link = screen.getByRole("link", { name: /download/i })
    expect(link).toHaveAttribute("href", base.downloadUrl)
  })

  it("renders an empty state", () => {
    render(<TransactionsCard {...base} totalCount={0} rows={[]} />)
    expect(screen.getByText(/no transactions/i)).toBeInTheDocument()
  })

  it("shows a truncation note", () => {
    render(
      <TransactionsCard
        {...base}
        totalCount={150}
        truncated
        rows={[
          {
            id: "t1",
            type: "buy",
            status: "completed",
            direction: "in",
            amount: "+10 USDT",
            sub: "2026-06-10",
          },
        ]}
      />
    )
    expect(screen.getByText(/latest/i)).toBeInTheDocument()
  })
})
