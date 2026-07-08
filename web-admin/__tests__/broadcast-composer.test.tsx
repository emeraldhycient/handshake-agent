/**
 * NotificationsPage broadcast composer — certification of the interactive
 * behaviours the composer wires (funds-safety proposal-only posture, root §3.1/§3.5).
 *
 * FIX 1: EVERY send opens a confirm modal first — never a silent inline send. A
 * small audience (default seed: Lagos) gets a plain "Confirm broadcast" modal; only
 * its submit fires the REAL POST /admin/notifications/broadcast and the SERVER's
 * outcome drives the toast ("Broadcast sent" for a dispatched small audience).
 *
 * FIX 2: choosing the "Custom…" schedule reveals a `datetime-local` input so the
 * operator can pick a send time; the picked value flows into the confirm modal's
 * change preview and the request's `schedule`.
 */
import { describe, expect, it, beforeEach, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { NotificationsPage } from "@/components/admin/notifications-page"
import { defaultToastStore } from "@/lib/store/toast-store"

// The composer's TEMPLATE select is wired to the real notification-templates list
// (Phase 6a) and its send to POST /admin/notifications/broadcast (Phase 7); mock the
// client so no server is needed. `sendBroadcast` resolves a `dispatched` small-
// audience outcome by default.
vi.mock("@/lib/api/notifications", () => ({
  listNotificationTemplates: vi.fn(),
  getDeliveryLog: vi.fn().mockResolvedValue({
    items: [],
    stats: { bounceRate: 0, complaintRate: 0, sampleSize: 0 },
  }),
  sendBroadcast: vi.fn().mockResolvedValue({
    outcome: "dispatched",
    recipientCount: 2140,
    changeRequestId: null,
  }),
}))

// The signed-in admin (drives the step-up dialog's password-vs-TOTP mode).
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn().mockResolvedValue({
    id: "11111111-1111-1111-1111-111111111111",
    email: "amara@handshake.ng",
    role: { id: "00000000-0000-0000-0000-000000000001", name: "Super Admin" },
    status: "active",
    displayName: "Test Admin",
    mfaEnabled: false,
    permissions: [],
    menus: [],
    pages: [],
  }),
}))

import { listNotificationTemplates, sendBroadcast } from "@/lib/api/notifications"

const mockListTemplates = vi.mocked(listNotificationTemplates)
const mockSendBroadcast = vi.mocked(sendBroadcast)

// The composer only offers REAL template keys — the api 422s unknown ones.
const TEMPLATES = {
  items: [
    {
      id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      templateKey: "kyc_reminder",
      language: "en",
      channel: "whatsapp" as const,
      subject: null,
      contentText: "Reminder to finish KYC, {{name}}.",
      contentHtml: null,
      whatsappTemplateId: "wa_1",
      variables: [],
    },
  ],
}

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
  mockListTemplates.mockReset()
  mockListTemplates.mockResolvedValue(TEMPLATES)
  mockSendBroadcast.mockClear()
  mockSendBroadcast.mockResolvedValue({
    outcome: "dispatched",
    recipientCount: 2140,
    changeRequestId: null,
  })
})

describe("NotificationsPage broadcast composer", () => {
  it("opens a confirm modal for a small audience and only fires the real send on submit", async () => {
    const user = userEvent.setup()
    renderPage()

    // The Send CTA enables once the REAL template list resolves.
    await screen.findByRole("option", { name: "kyc_reminder" })

    // Default seed audience (Lagos · 2,140) is below the maker-checker threshold.
    const cta = screen.getByRole("button", { name: /Send broadcast/i })
    await user.click(cta)

    // No inline send — a confirm modal appears first and NOTHING has fired yet.
    expect(
      screen.getByRole("heading", { name: /Confirm broadcast/i })
    ).toBeInTheDocument()
    expect(mockSendBroadcast).not.toHaveBeenCalled()
    expect(defaultToastStore.getState().toasts).toHaveLength(0)

    await user.click(screen.getByRole("button", { name: /Confirm change/i }))

    // The real broadcast POST fires with the composed request (Lagos, immediate)
    // and a REAL template key (the api 422s unknown ones).
    await waitFor(() => expect(mockSendBroadcast).toHaveBeenCalledTimes(1))
    const request = mockSendBroadcast.mock.calls[0][0]
    expect(request.audience).toBe("lagos")
    expect(request.templateKey).toBe("kyc_reminder")
    expect(request.schedule).toEqual({ kind: "now" })

    // The server's `dispatched` outcome drives the CTA + an ok toast.
    expect(
      await screen.findByRole("button", { name: /Broadcast sent/i })
    ).toBeInTheDocument()
    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toMatch(/Broadcast sent/i)
    expect(toasts[0].kind).toBe("ok")
  })

  it("never sends without the confirm modal (no direct CTA-to-send path)", async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole("option", { name: "kyc_reminder" })
    await user.click(screen.getByRole("button", { name: /Send broadcast/i }))
    // The confirm modal is up but the send has not fired.
    expect(mockSendBroadcast).not.toHaveBeenCalled()
  })

  it("disables Send with a hint while the template list is empty (no unknown-key 422s)", async () => {
    mockListTemplates.mockResolvedValue({ items: [] })
    renderPage()

    // The hint explains WHY sending is unavailable.
    expect(
      await screen.findByText(/create a notification template/i)
    ).toBeInTheDocument()
    const cta = screen.getByRole("button", { name: /Send broadcast/i })
    expect(cta).toBeDisabled()
    // No fallback design keys leak into the TEMPLATE select.
    expect(
      screen.queryByRole("option", { name: "tx_confirmation" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("option", { name: "promo_ticketing" })
    ).not.toBeInTheDocument()
  })

  it("passes a scheduled sendAt when a custom time is chosen", async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole("option", { name: "kyc_reminder" })
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Broadcast schedule/i }),
      "custom"
    )
    await user.type(screen.getByLabelText("Custom send time"), "2026-07-02T09:00")

    await user.click(screen.getByRole("button", { name: /Send broadcast/i }))
    await user.click(screen.getByRole("button", { name: /Confirm change/i }))

    await waitFor(() => expect(mockSendBroadcast).toHaveBeenCalledTimes(1))
    const request = mockSendBroadcast.mock.calls[0][0]
    expect(request.schedule.kind).toBe("scheduled")
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
