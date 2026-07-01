/**
 * UserDetail interactivity tests (design reproduction).
 *
 * The screen renders the design's OWN mock user (Amara Okeke); these tests cover the
 * wired behaviours added on top of the pixel repro:
 *  - deep-link tab seeding from `?tab=` (KYC-queue links land on the KYC tab),
 *  - copy-to-clipboard toasts (user id),
 *  - header quick-actions (Resend / View as) toasts,
 *  - reactive per-row mutations (revoke session, remove beneficiary) through the
 *    shared ReasonModal confirm flow.
 *
 * `next/navigation` is stubbed; the search params are swapped per-test via a mutable
 * holder so a single module mock can serve both the default and deep-link cases.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { UserDetail } from "@/components/admin/user-detail"
import { defaultToastStore } from "@/lib/store/toast-store"

// Mutable search-params holder so each test can seed `?tab=` before rendering.
let searchParams = new URLSearchParams()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParams,
}))

beforeEach(() => {
  searchParams = new URLSearchParams()
  defaultToastStore.setState({ toasts: [] })
})

/** Drive a ReasonModal-fronted flow to completion (type a reason → Continue). */
async function confirmReason(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Reason"), "test reason")
  await user.click(screen.getByRole("button", { name: "Continue" }))
}

describe("UserDetail (design reproduction) interactivity", () => {
  it("defaults to the Profile tab when no ?tab= is present", () => {
    render(<UserDetail userId="usr_10480" />)
    expect(screen.getByRole("button", { name: "Profile" })).toHaveAttribute(
      "aria-current",
      "page"
    )
  })

  it("deep-links to the KYC tab from ?tab=kyc", () => {
    searchParams = new URLSearchParams("tab=kyc")
    render(<UserDetail userId="usr_10480" />)
    expect(screen.getByRole("button", { name: "KYC" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    // KYC-tab-only content is shown.
    expect(screen.getByText("Identity documents")).toBeInTheDocument()
  })

  it("falls back to Profile for an unknown ?tab= value", () => {
    searchParams = new URLSearchParams("tab=not-a-tab")
    render(<UserDetail userId="usr_10480" />)
    expect(screen.getByRole("button", { name: "Profile" })).toHaveAttribute(
      "aria-current",
      "page"
    )
  })

  it("toasts a copy confirmation when the user id chip is clicked", async () => {
    const user = userEvent.setup()
    render(<UserDetail userId="usr_10480" />)

    await user.click(screen.getByRole("button", { name: /usr_10480/ }))

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({
      message: "Copied · usr_10480",
      kind: "copy",
    })
  })

  it("toasts from the header Resend and View-as quick actions", async () => {
    const user = userEvent.setup()
    render(<UserDetail userId="usr_10480" />)

    await user.click(screen.getByRole("button", { name: "Resend" }))
    await user.click(screen.getByRole("button", { name: "View as" }))

    const { toasts } = defaultToastStore.getState()
    expect(toasts.map((t) => t.message)).toEqual([
      "Verification link re-sent",
      "Now viewing as Amara Okeke",
    ])
  })

  it("prepends a note to the timeline via the Add-note flow", async () => {
    const user = userEvent.setup()
    render(<UserDetail userId="usr_10480" />)

    // Profile tab is default; open the timeline Add-note flow.
    await user.click(screen.getByRole("button", { name: "+ Add note" }))
    await user.type(screen.getByLabelText("Reason"), "Called customer re: KYC")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    expect(screen.getByText("Called customer re: KYC")).toBeInTheDocument()
    expect(
      defaultToastStore
        .getState()
        .toasts.some((t) => t.message === "Note added to timeline")
    ).toBe(true)
  })

  it("removes a session row when its Revoke flow is confirmed", async () => {
    const user = userEvent.setup()
    render(<UserDetail userId="usr_10480" />)

    await user.click(screen.getByRole("button", { name: "Security" }))
    expect(screen.getByText("iPhone 14 · Lagos")).toBeInTheDocument()

    // The single-session mock renders exactly one per-row "Revoke".
    await user.click(screen.getByRole("button", { name: "Revoke" }))
    await confirmReason(user)

    expect(screen.queryByText("iPhone 14 · Lagos")).not.toBeInTheDocument()
    expect(
      defaultToastStore
        .getState()
        .toasts.some((t) => t.message === "Session revoked")
    ).toBe(true)
  })

  it("removes a beneficiary row when its Remove flow is confirmed", async () => {
    const user = userEvent.setup()
    render(<UserDetail userId="usr_10480" />)

    await user.click(screen.getByRole("button", { name: "Beneficiaries" }))
    expect(screen.getByText("GTBank · Amara Okeke")).toBeInTheDocument()

    const removes = screen.getAllByRole("button", { name: "Remove" })
    await user.click(removes[0])
    await confirmReason(user)

    expect(screen.queryByText("GTBank · Amara Okeke")).not.toBeInTheDocument()
    // The second beneficiary remains.
    expect(screen.getByText("USDT address")).toBeInTheDocument()
    expect(
      defaultToastStore
        .getState()
        .toasts.some((t) => t.message === "Beneficiary removed")
    ).toBe(true)
  })
})
