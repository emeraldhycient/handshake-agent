import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { DepositNetworkWarning } from "./deposit-network-warning"

describe("DepositNetworkWarning", () => {
  it("names the asset and network in the warning copy", () => {
    render(<DepositNetworkWarning asset="USDT" network="TRON · TRC-20" />)
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent(/USDT/)
    expect(alert).toHaveTextContent(/TRON/)
  })

  it("states that other assets/networks are lost permanently", () => {
    render(<DepositNetworkWarning asset="USDT" network="TRON" />)
    expect(screen.getByRole("alert")).toHaveTextContent(/lost permanently/i)
  })

  it("renders a warning glyph so danger is not conveyed by color alone", () => {
    render(<DepositNetworkWarning asset="USDT" network="TRON" />)
    expect(screen.getByRole("alert").querySelector("svg")).not.toBeNull()
  })

  it("forwards a className", () => {
    render(
      <DepositNetworkWarning asset="USDT" network="TRON" className="mt-2" />
    )
    expect(screen.getByRole("alert")).toHaveClass("mt-2")
  })
})
