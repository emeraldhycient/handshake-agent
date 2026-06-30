import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest"
import { DashboardExperience } from "./dashboard-experience"
import { defaultChatStore } from "@/lib/store/chat-store"
import { defaultAuthStore } from "@/lib/store/auth-store"
import { actionPrompt, chipLabel } from "@/lib/chat/flow"

const mockRouterPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => {
  defaultAuthStore.setState({ status: "anonymous" })
  vi.restoreAllMocks()
  mockRouterPush.mockReset()
})

describe("DashboardExperience", () => {
  it("wires the session-expired handler to route to /login on mount (finding #4)", () => {
    const setHandler = vi.spyOn(
      defaultChatStore.getState(),
      "setSessionExpiredHandler"
    )
    render(<DashboardExperience />, { wrapper })
    expect(setHandler).toHaveBeenCalledTimes(1)
    // Invoking the registered handler routes to /login.
    const handler = setHandler.mock.calls[0][0]
    handler()
    expect(mockRouterPush).toHaveBeenCalledWith("/login")
  })

  describe("authenticated quick actions", () => {
    beforeEach(() => {
      defaultAuthStore.setState({ status: "authenticated" })
    })

    it("hero Buy calls sendToAgent with the amount-free prompt (not the mock send)", async () => {
      const user = userEvent.setup()
      const sendToAgent = vi
        .spyOn(defaultChatStore.getState(), "sendToAgent")
        .mockResolvedValue(undefined)
      const send = vi.spyOn(defaultChatStore.getState(), "send")

      render(<DashboardExperience />, { wrapper })
      // Exact name "Buy" targets the hero/quick-action button, not the chat
      // composer chip whose accessible name is the full "Buy ₦50,000 of USDT".
      const buyBtns = await screen.findAllByRole(
        "button",
        { name: "Buy" },
        { timeout: 3000 }
      )
      await user.click(buyBtns[0])

      expect(sendToAgent).toHaveBeenCalledWith("d", actionPrompt("buy"))
      expect(send).not.toHaveBeenCalledWith(
        "d",
        chipLabel("buy"),
        expect.anything()
      )
    })
  })

  describe("anonymous quick actions", () => {
    it("hero Buy uses the mock send (offline demo)", async () => {
      const user = userEvent.setup()
      defaultAuthStore.setState({ status: "anonymous" })
      const sendToAgent = vi.spyOn(defaultChatStore.getState(), "sendToAgent")
      const send = vi.spyOn(defaultChatStore.getState(), "send")

      render(<DashboardExperience />, { wrapper })
      const buyBtns = await screen.findAllByRole(
        "button",
        { name: "Buy" },
        { timeout: 3000 }
      )
      await user.click(buyBtns[0])

      expect(send).toHaveBeenCalledWith("d", chipLabel("buy"), "buy")
      expect(sendToAgent).not.toHaveBeenCalled()
    })
  })
})
