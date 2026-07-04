import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Providers } from "./providers"

vi.mock("next-google-translate-widget", () => ({
  default: () => <div data-testid="gt-engine" />,
}))

describe("Providers", () => {
  it("renders children", () => {
    render(
      <Providers>
        <span>hello</span>
      </Providers>
    )
    expect(screen.getByText("hello")).toBeInTheDocument()
  })

  it("mounts the translation engine", () => {
    render(
      <Providers>
        <span>child</span>
      </Providers>
    )
    expect(screen.getByTestId("gt-engine")).toBeInTheDocument()
  })
})
