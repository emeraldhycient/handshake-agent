import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Providers } from "./providers"

describe("Providers", () => {
  it("renders children", () => {
    render(
      <Providers>
        <span>hello</span>
      </Providers>
    )
    expect(screen.getByText("hello")).toBeInTheDocument()
  })
})
