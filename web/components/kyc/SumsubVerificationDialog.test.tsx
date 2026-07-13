/**
 * TDD tests for SumsubVerificationDialog — the modal wrapper that presents the
 * Sumsub verification surface over the current screen (Settings + onboarding
 * wizard) instead of a full-screen route/step.
 *
 * The dialog owns none of the token/SDK logic — it wraps `SumsubVerification`
 * (mocked here to a stub that echoes its level and exposes a submit button) and
 * closes itself the moment the applicant finishes, forwarding `onSubmitted` up.
 */
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// Stub the SDK surface so the dialog test stays focused on open/close + wiring.
const sdkLevel = vi.hoisted(() => ({ current: null as string | null }))
vi.mock("@/components/kyc/SumsubVerification", () => ({
  SumsubVerification: (props: { level: string; onSubmitted?: () => void }) => {
    sdkLevel.current = props.level
    return (
      <div data-testid="sumsub-surface">
        <span data-testid="sumsub-level">{props.level}</span>
        <button type="button" onClick={() => props.onSubmitted?.()}>
          emit-submitted
        </button>
      </div>
    )
  },
}))

import { SumsubVerificationDialog } from "./SumsubVerificationDialog"

describe("SumsubVerificationDialog", () => {
  it("does not render the verification surface while closed", () => {
    render(
      <SumsubVerificationDialog
        open={false}
        onOpenChange={vi.fn()}
        level="tier_2"
      />
    )
    expect(screen.queryByTestId("sumsub-surface")).not.toBeInTheDocument()
  })

  it("renders the title, level-specific copy, and the surface for the requested rung when open", () => {
    render(
      <SumsubVerificationDialog open onOpenChange={vi.fn()} level="tier_3" />
    )
    expect(
      screen.getByRole("heading", { name: /verify your identity/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/proof of address/i)).toBeInTheDocument()
    expect(screen.getByTestId("sumsub-level")).toHaveTextContent("tier_3")
  })

  it("forwards onSubmitted and closes itself when the applicant finishes", async () => {
    const onOpenChange = vi.fn()
    const onSubmitted = vi.fn()
    render(
      <SumsubVerificationDialog
        open
        onOpenChange={onOpenChange}
        level="tier_2"
        onSubmitted={onSubmitted}
      />
    )
    await userEvent.click(
      screen.getByRole("button", { name: /emit-submitted/i })
    )
    expect(onSubmitted).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
