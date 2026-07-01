/**
 * UsersPage render test (design reproduction).
 *
 * UsersPage was rebuilt as a pixel-faithful reproduction of the design's Users
 * screen: it renders its own module-level 28-user mock dataset (no `@/lib/api/users`,
 * no `getMe`, no tier-adjust mutation, no step-up-on-403 drawer). The old
 * behavioural tests drove those api/step-up flows, which the reproduction no longer
 * has, so they are replaced with a render test asserting the reproduced design
 * content: the heading, the customer table headers, a known mock user row, and the
 * SIM-swap risk badge that the design shows on flagged users.
 *
 * The rebuilt page navigates on row click (`useRouter().push`), so `next/navigation`
 * is stubbed.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { UsersPage } from "@/components/admin/users-page"
import { defaultToastStore } from "@/lib/store/toast-store"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
})

describe("UsersPage (design reproduction)", () => {
  it("renders the header and the customer table columns", () => {
    render(<UsersPage />)

    expect(screen.getByRole("heading", { name: "Users" })).toBeInTheDocument()
    // Table column headers from the 7-column customer table.
    expect(screen.getByText("Customer")).toBeInTheDocument()
    expect(screen.getByText("KYC")).toBeInTheDocument()
    expect(screen.getByText("Risk")).toBeInTheDocument()
    expect(screen.getByText("Last active")).toBeInTheDocument()
  })

  it("renders mock users and the SIM-swap badge on a flagged user", () => {
    render(<UsersPage />)

    // A known mock user from the design's seed dataset (first page, 10/page).
    expect(screen.getByText("Amara Okeke")).toBeInTheDocument()
    // Ngozi Balogun carries the `simSwap` flag → the SIM-SWAP risk badge.
    expect(screen.getByText("Ngozi Balogun")).toBeInTheDocument()
    expect(screen.getAllByText("SIM-SWAP").length).toBeGreaterThanOrEqual(1)
  })

  it("toasts a CSV export over the full filtered set from the header button", async () => {
    const user = userEvent.setup()
    render(<UsersPage />)

    // With no rows selected, the count falls back to the 28-user filtered list.
    await user.click(screen.getByRole("button", { name: "Export CSV" }))

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe("Exporting 28 users to CSV…")
    expect(toasts[0].kind).toBe("info")
  })

  it("toasts export/tag/message over the selected set from the bulk bar", async () => {
    const user = userEvent.setup()
    render(<UsersPage />)

    // Select one row → the dark bulk bar appears with Export / Tag / Message.
    await user.click(screen.getByRole("button", { name: "Select Amara Okeke" }))

    await user.click(screen.getByRole("button", { name: "Export" }))
    await user.click(screen.getByRole("button", { name: "Tag" }))
    await user.click(screen.getByRole("button", { name: "Message" }))

    const { toasts } = defaultToastStore.getState()
    expect(toasts.map((t) => [t.message, t.kind])).toEqual([
      ["Exporting 1 users to CSV…", "info"],
      ["Tag applied to 1 users", "ok"],
      ["Composer opened for 1 users", "info"],
    ])
  })
})
