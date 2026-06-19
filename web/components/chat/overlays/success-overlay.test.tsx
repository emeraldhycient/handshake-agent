"use client"

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SuccessOverlay } from "./success-overlay"

describe("SuccessOverlay", () => {
  it("renders the check mark and text when open", () => {
    render(<SuccessOverlay open text="Purchase complete!" />)
    expect(screen.getByTestId("success")).toBeInTheDocument()
    expect(screen.getByText("Purchase complete!")).toBeInTheDocument()
  })

  it("renders nothing when open is false", () => {
    const { container } = render(
      <SuccessOverlay open={false} text="Purchase complete!" />
    )
    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId("success")).toBeNull()
  })

  it("renders the provided text", () => {
    render(<SuccessOverlay open text="Ticket purchased!" />)
    expect(screen.getByText("Ticket purchased!")).toBeInTheDocument()
  })
})
