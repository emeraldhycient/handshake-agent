/**
 * ProvidersPage — certification of the "Test connection" action.
 *
 * The design binds each provider card's "Test connection" button to `p.onTest`
 * (a toast). This asserts the button is live: clicking it enqueues a toast that
 * names the provider. No live probe runs — it is a read-shaped confirmation
 * (§3.1); the design reproduction mirrors the design's toast, nothing more.
 */
import { describe, expect, it, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { ProvidersPage } from "@/components/admin/providers-page"
import { defaultToastStore } from "@/lib/store/toast-store"

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
})

describe("ProvidersPage", () => {
  it("toasts a connection test naming the provider when clicked", async () => {
    const user = userEvent.setup()
    render(<ProvidersPage />)

    // The first provider card is Blockradar (design seed `providerRows`).
    const button = screen.getByRole("button", {
      name: /Test connection to Blockradar/i,
    })
    await user.click(button)

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toMatch(/Blockradar/)
    expect(toasts[0].message).toMatch(/connection/i)
  })
})
