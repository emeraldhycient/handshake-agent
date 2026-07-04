import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { InstallModal } from "./install-modal"

function makeBip(outcome: "accepted" | "dismissed") {
  const evt = new Event("beforeinstallprompt") as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
  }
  evt.prompt = vi.fn().mockResolvedValue(undefined)
  evt.userChoice = Promise.resolve({ outcome })
  return evt
}

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: ua,
  })
}

describe("InstallModal", () => {
  afterEach(() => {
    setUserAgent("node")
    vi.restoreAllMocks()
  })

  it("renders nothing when closed", () => {
    render(<InstallModal open={false} onOpenChange={() => {}} />)
    expect(
      screen.queryByRole("dialog", { name: /install handshake agent/i })
    ).not.toBeInTheDocument()
  })

  it("shows the titled dialog and a scannable QR when open", () => {
    render(<InstallModal open onOpenChange={() => {}} />)
    expect(
      screen.getByRole("dialog", { name: /install handshake agent/i })
    ).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /scan/i })).toBeInTheDocument()
  })

  it("shows iOS instructions when running on iOS Safari", () => {
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
    )
    render(<InstallModal open onOpenChange={() => {}} />)
    expect(screen.getByText(/add to home screen/i)).toBeInTheDocument()
  })

  it("fires the native prompt and closes on acceptance", async () => {
    const bip = makeBip("accepted")
    const onOpenChange = vi.fn()
    render(<InstallModal open onOpenChange={onOpenChange} />)

    window.dispatchEvent(bip)
    const btn = await screen.findByRole("button", { name: /install app/i })
    await userEvent.click(btn)

    await waitFor(() => expect(bip.prompt).toHaveBeenCalledOnce())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
