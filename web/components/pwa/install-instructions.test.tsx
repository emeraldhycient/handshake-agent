import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { InstallInstructions } from "./install-instructions"

describe("InstallInstructions", () => {
  it("offers a one-tap install button when a native prompt is available", async () => {
    const onInstall = vi.fn()
    render(
      <InstallInstructions
        canPrompt
        isIOS={false}
        installing={false}
        onInstall={onInstall}
      />
    )
    const btn = screen.getByRole("button", { name: /install app/i })
    await userEvent.click(btn)
    expect(onInstall).toHaveBeenCalledOnce()
  })

  it("disables the button while the prompt is in flight", () => {
    render(
      <InstallInstructions
        canPrompt
        isIOS={false}
        installing
        onInstall={() => {}}
      />
    )
    expect(screen.getByRole("button", { name: /install/i })).toBeDisabled()
  })

  it("shows iOS Add to Home Screen steps when there is no native prompt on iOS", () => {
    render(
      <InstallInstructions
        canPrompt={false}
        isIOS
        installing={false}
        onInstall={() => {}}
      />
    )
    expect(screen.getByText(/add to home screen/i)).toBeInTheDocument()
    expect(screen.getByText(/share/i)).toBeInTheDocument()
    // No native button on iOS.
    expect(
      screen.queryByRole("button", { name: /install app/i })
    ).not.toBeInTheDocument()
  })

  it("gives a generic browser hint when install is neither promptable nor iOS", () => {
    render(
      <InstallInstructions
        canPrompt={false}
        isIOS={false}
        installing={false}
        onInstall={() => {}}
      />
    )
    expect(
      screen.getByText(/install icon in the address bar/i)
    ).toBeInTheDocument()
  })
})
