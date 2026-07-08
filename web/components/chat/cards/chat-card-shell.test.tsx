import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ChatCardShell } from "./chat-card-shell"

describe("ChatCardShell", () => {
  it("renders the mobile shell classes (wide, rounded-20, shadow-card)", () => {
    const { container } = render(
      <ChatCardShell density="mobile">
        <span>x</span>
      </ChatCardShell>
    )
    const shell = container.firstElementChild as HTMLElement
    expect(shell.className).toContain("border-border")
    expect(shell.className).toContain("w-[88%]")
    expect(shell.className).toContain("rounded-[20px]")
    expect(shell.className).toContain("shadow-card")
  })

  it("renders the desktop shell classes and no raised shadow by default", () => {
    const { container } = render(
      <ChatCardShell density="desktop">
        <span>x</span>
      </ChatCardShell>
    )
    const shell = container.firstElementChild as HTMLElement
    expect(shell.className).toContain("w-[92%]")
    expect(shell.className).toContain("rounded-[16px]")
    expect(shell.className).not.toContain("oklch")
  })

  it("adds the raised desktop shadow when desktopShadow is set", () => {
    const { container } = render(
      <ChatCardShell density="desktop" desktopShadow>
        <span>x</span>
      </ChatCardShell>
    )
    const shell = container.firstElementChild as HTMLElement
    expect(shell.className).toContain("oklch")
  })

  it("merges a passthrough className", () => {
    const { container } = render(
      <ChatCardShell density="mobile" className="mt-4">
        <span>x</span>
      </ChatCardShell>
    )
    expect((container.firstElementChild as HTMLElement).className).toContain(
      "mt-4"
    )
  })
})
