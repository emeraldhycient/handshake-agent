/**
 * NotificationsPage broadcast composer — certification of the two interactive
 * behaviours the design wires (funds-safety proposal-only posture, root §3.1).
 *
 * FIX 1: EVERY send opens a confirm modal first — never a silent inline send. A
 * small audience (default seed: Lagos) gets a plain "Confirm broadcast" modal;
 * only its submit marks the CTA "Broadcast sent" and enqueues an ok toast.
 *
 * FIX 2: choosing the "Custom…" schedule reveals a `datetime-local` input so the
 * operator can pick a send time; the picked value flows into the confirm modal's
 * change preview.
 */
import { describe, expect, it, beforeEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { NotificationsPage } from "@/components/admin/notifications-page"
import { defaultToastStore } from "@/lib/store/toast-store"

// The composer's TEMPLATE select is wired to the real notification-templates list
// (Phase 6a); mock the client so no server is needed. These tests only exercise
// the audience/schedule/confirm behaviours, so an empty list (composer falls back
// to the design's own template keys) is sufficient.
vi.mock("@/lib/api/notifications", () => ({
  listNotificationTemplates: vi.fn().mockResolvedValue({ items: [] }),
}))

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <NotificationsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
})

describe("NotificationsPage broadcast composer", () => {
  it("opens a confirm modal for a small audience and only sends on submit", async () => {
    const user = userEvent.setup()
    renderPage()

    // Default seed audience (Lagos · 2,140) is below the maker-checker threshold.
    const cta = screen.getByRole("button", { name: /Send broadcast/i })
    await user.click(cta)

    // No inline send — a confirm modal appears first.
    expect(
      screen.getByRole("heading", { name: /Confirm broadcast/i })
    ).toBeInTheDocument()
    expect(defaultToastStore.getState().toasts).toHaveLength(0)

    await user.click(
      screen.getByRole("button", { name: /Submit for approval/i })
    )

    // Now the CTA reflects the send and an ok toast is enqueued.
    expect(
      screen.getByRole("button", { name: /Broadcast sent/i })
    ).toBeInTheDocument()
    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toMatch(/Broadcast sent/i)
    expect(toasts[0].kind).toBe("ok")
  })

  it("reveals a datetime input for the Custom schedule", async () => {
    const user = userEvent.setup()
    renderPage()

    // No custom time picker until "Custom…" is chosen.
    expect(screen.queryByLabelText("Custom send time")).not.toBeInTheDocument()

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Broadcast schedule/i }),
      "custom"
    )

    const picker = screen.getByLabelText("Custom send time")
    expect(picker).toHaveAttribute("type", "datetime-local")

    await user.type(picker, "2026-07-02T09:00")
    expect(picker).toHaveValue("2026-07-02T09:00")
  })
})
