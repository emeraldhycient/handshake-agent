import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { QrCode } from "./qr-code"

describe("QrCode", () => {
  it("renders an accessible QR image region with an svg", () => {
    render(<QrCode value="https://app.example.ng" label="Scan to install" />)
    const region = screen.getByRole("img", { name: "Scan to install" })
    expect(region.querySelector("svg")).not.toBeNull()
  })
})
