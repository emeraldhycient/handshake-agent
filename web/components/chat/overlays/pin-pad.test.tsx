"use client"

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { PinPad } from "./pin-pad"

describe("PinPad", () => {
  it("renders digit buttons 0–9", () => {
    render(
      <PinPad
        open
        pinLength={0}
        density="mobile"
        onDigit={() => {}}
        onBack={() => {}}
        onFaceId={() => {}}
        onCancel={() => {}}
      />
    )
    for (const d of "0123456789".split("")) {
      expect(screen.getByRole("button", { name: d })).toBeInTheDocument()
    }
  })

  it("renders a Face ID button", () => {
    render(
      <PinPad
        open
        pinLength={0}
        density="mobile"
        onDigit={() => {}}
        onBack={() => {}}
        onFaceId={() => {}}
        onCancel={() => {}}
      />
    )
    expect(screen.getByRole("button", { name: /face id/i })).toBeInTheDocument()
  })

  it("renders a backspace button", () => {
    render(
      <PinPad
        open
        pinLength={0}
        density="mobile"
        onDigit={() => {}}
        onBack={() => {}}
        onFaceId={() => {}}
        onCancel={() => {}}
      />
    )
    expect(
      screen.getByRole("button", { name: /backspace/i })
    ).toBeInTheDocument()
  })

  it("shows 4 dots, pinLength of them filled", () => {
    const { rerender } = render(
      <PinPad
        open
        pinLength={2}
        density="mobile"
        onDigit={() => {}}
        onBack={() => {}}
        onFaceId={() => {}}
        onCancel={() => {}}
      />
    )
    const filled = document.querySelectorAll("[data-filled='true']")
    const unfilled = document.querySelectorAll("[data-filled='false']")
    expect(filled).toHaveLength(2)
    expect(unfilled).toHaveLength(2)

    rerender(
      <PinPad
        open
        pinLength={4}
        density="mobile"
        onDigit={() => {}}
        onBack={() => {}}
        onFaceId={() => {}}
        onCancel={() => {}}
      />
    )
    expect(document.querySelectorAll("[data-filled='true']")).toHaveLength(4)
    expect(document.querySelectorAll("[data-filled='false']")).toHaveLength(0)
  })

  it("calls onDigit with the pressed digit when a digit button is clicked", async () => {
    const onDigit = vi.fn()
    render(
      <PinPad
        open
        pinLength={0}
        density="mobile"
        onDigit={onDigit}
        onBack={() => {}}
        onFaceId={() => {}}
        onCancel={() => {}}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "7" }))
    expect(onDigit).toHaveBeenCalledWith("7")
  })

  it("calls onFaceId when Face ID button is clicked", async () => {
    const onFaceId = vi.fn()
    render(
      <PinPad
        open
        pinLength={0}
        density="mobile"
        onDigit={() => {}}
        onBack={() => {}}
        onFaceId={onFaceId}
        onCancel={() => {}}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: /face id/i }))
    expect(onFaceId).toHaveBeenCalledOnce()
  })

  it("calls onBack when Backspace button is clicked", async () => {
    const onBack = vi.fn()
    render(
      <PinPad
        open
        pinLength={1}
        density="mobile"
        onDigit={() => {}}
        onBack={onBack}
        onFaceId={() => {}}
        onCancel={() => {}}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: /backspace/i }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it("calls onCancel when Cancel button is clicked", async () => {
    const onCancel = vi.fn()
    render(
      <PinPad
        open
        pinLength={0}
        density="mobile"
        onDigit={() => {}}
        onBack={() => {}}
        onFaceId={() => {}}
        onCancel={onCancel}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it("renders nothing when open is false", () => {
    const { container } = render(
      <PinPad
        open={false}
        pinLength={0}
        density="mobile"
        onDigit={() => {}}
        onBack={() => {}}
        onFaceId={() => {}}
        onCancel={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders on desktop density", () => {
    render(
      <PinPad
        open
        pinLength={0}
        density="desktop"
        onDigit={() => {}}
        onBack={() => {}}
        onFaceId={() => {}}
        onCancel={() => {}}
      />
    )
    expect(screen.getByRole("button", { name: "5" })).toBeInTheDocument()
  })
})
