import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { StatusPill } from "./status-pill"

describe("StatusPill", () => {
  it("renders children text (color is never the only signal)", () => {
    render(<StatusPill tone="success">Completed</StatusPill>)
    expect(screen.getByText("Completed")).toBeInTheDocument()
  })

  it("success tone applies success token classes", () => {
    render(<StatusPill tone="success">Completed</StatusPill>)
    const el = screen.getByText("Completed")
    expect(el).toHaveClass("bg-success-muted")
    expect(el).toHaveClass("text-success")
  })

  it("warn tone applies warn token classes", () => {
    render(<StatusPill tone="warn">Pending</StatusPill>)
    const el = screen.getByText("Pending")
    expect(el).toHaveClass("bg-warn-muted")
    expect(el).toHaveClass("text-warn")
  })

  it("info tone applies info token classes", () => {
    render(<StatusPill tone="info">Processing</StatusPill>)
    const el = screen.getByText("Processing")
    expect(el).toHaveClass("bg-info-muted")
    expect(el).toHaveClass("text-info")
  })

  it("neutral tone applies muted token classes", () => {
    render(<StatusPill tone="neutral">Inactive</StatusPill>)
    const el = screen.getByText("Inactive")
    expect(el).toHaveClass("bg-muted")
    expect(el).toHaveClass("text-muted-foreground")
  })

  it("has rounded-full pill shape class", () => {
    render(<StatusPill tone="success">OK</StatusPill>)
    const el = screen.getByText("OK")
    expect(el).toHaveClass("rounded-full")
  })

  it("merges additional className", () => {
    render(
      <StatusPill tone="success" className="custom-class">
        Done
      </StatusPill>
    )
    const el = screen.getByText("Done")
    expect(el).toHaveClass("custom-class")
  })
})
