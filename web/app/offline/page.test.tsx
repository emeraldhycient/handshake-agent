import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import OfflinePage from "./page"

describe("/offline", () => {
  it("tells the user they are offline inside a main landmark", () => {
    render(<OfflinePage />)
    expect(screen.getByRole("main")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: /offline/i })
    ).toBeInTheDocument()
  })

  it("offers a way to retry", () => {
    render(<OfflinePage />)
    expect(screen.getByRole("link", { name: /try again/i })).toHaveAttribute(
      "href",
      "/"
    )
  })
})
