import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { CopyButton } from "./copy-button"

describe("CopyButton", () => {
  it("labels itself for a11y", () => {
    render(<CopyButton value="0xabc" label="tx hash" />)
    expect(
      screen.getByRole("button", { name: /copy tx hash/i })
    ).toBeInTheDocument()
  })

  it("copies the value and flips to a copied state on click", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
    })
    render(<CopyButton value="0xabc" label="tx hash" />)
    await user.click(screen.getByRole("button"))
    expect(writeText).toHaveBeenCalledWith("0xabc")
    expect(
      screen.getByRole("button", { name: /tx hash copied/i })
    ).toBeInTheDocument()
  })
})
