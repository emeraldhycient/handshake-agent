import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { createChatStore } from "@/lib/store/chat-store"
import { chipLabel } from "@/lib/chat/flow"
import { ChatRail } from "./chat-rail"

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return Wrapper
}

// Synchronous scheduler — no real setTimeout
const immediate = (fn: () => void) => fn()

vi.mock("@/hooks/use-voice-recorder", () => ({
  useVoiceRecorder: () => ({
    status: "recording",
    seconds: 0,
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(new Blob(["x"], { type: "audio/webm" })),
    cancel: vi.fn(),
  }),
}))

describe("ChatRail", () => {
  it("renders the greeting message on the desktop surface", () => {
    const store = createChatStore({ schedule: immediate })
    render(<ChatRail store={store} />, { wrapper: makeWrapper() })
    const greeting = store.getState().threads.d[0]
    if (greeting.kind === "text") {
      expect(screen.getByText(greeting.text)).toBeInTheDocument()
    }
  })

  it("renders chip buttons", () => {
    const store = createChatStore({ schedule: immediate })
    render(<ChatRail store={store} />, { wrapper: makeWrapper() })
    expect(
      screen.getByRole("button", { name: chipLabel("buy") })
    ).toBeInTheDocument()
  })

  it("renders the agent header (Handshake Agent + Online)", () => {
    const store = createChatStore({ schedule: immediate })
    render(<ChatRail store={store} />, { wrapper: makeWrapper() })
    expect(screen.getByText("Handshake Agent")).toBeInTheDocument()
    expect(screen.getByText(/online/i)).toBeInTheDocument()
  })

  it("FULL MONEY-PATH: chip → quote → confirm → PIN → receipt; NO receipt before 4th digit", async () => {
    const user = userEvent.setup()
    const store = createChatStore({ schedule: immediate })
    render(<ChatRail store={store} />, { wrapper: makeWrapper() })

    // 1. Click the "Buy ₦50,000 of USDT" chip
    await user.click(screen.getByRole("button", { name: chipLabel("buy") }))

    // Quote card appears
    expect(screen.getByText(chipLabel("buy"))).toBeInTheDocument()
    expect(screen.getByText("29.97 USDT")).toBeInTheDocument()

    // 2. No receipt yet (gate check #1)
    expect(screen.queryByText("Purchase complete")).not.toBeInTheDocument()

    // 3. Click "Review & confirm"
    await user.click(screen.getByRole("button", { name: /review & confirm/i }))
    await waitFor(() =>
      expect(screen.getAllByText("Confirm purchase").length).toBeGreaterThan(0)
    )

    // 4. Still no receipt (gate check #2)
    expect(screen.queryByText("Purchase complete")).not.toBeInTheDocument()

    // 5. Click "Confirm with PIN" → PinPad opens
    await user.click(screen.getByRole("button", { name: /confirm with pin/i }))
    await waitFor(() =>
      expect(screen.getByText("Enter your PIN")).toBeInTheDocument()
    )

    // 6. Press 3 digits — still no receipt (THE CRITICAL CHECK)
    await user.click(screen.getByRole("button", { name: "1" }))
    await user.click(screen.getByRole("button", { name: "2" }))
    await user.click(screen.getByRole("button", { name: "3" }))
    expect(screen.queryByText("Purchase complete")).not.toBeInTheDocument()

    // 7. Press 4th digit → receipt appears + success overlay
    await user.click(screen.getByRole("button", { name: "4" }))
    await waitFor(() =>
      expect(screen.getAllByText("Purchase complete").length).toBeGreaterThan(0)
    )
    expect(screen.getByTestId("success")).toBeInTheDocument()

    // PinPad should be gone
    expect(screen.queryByText("Enter your PIN")).not.toBeInTheDocument()
  })

  it('onRecordStop calls sendVoiceToAgent("d", blob) when recording stops', async () => {
    const user = userEvent.setup()
    const voiceApi = vi
      .fn()
      .mockResolvedValue({ outcome: { kind: "clarification", text: "ok" } })
    const store = createChatStore({ schedule: immediate, voiceApi })
    const sendVoiceSpy = vi.spyOn(store.getState(), "sendVoiceToAgent")
    render(<ChatRail store={store} />, { wrapper: makeWrapper() })

    // useVoiceRecorder is mocked to status:"recording", so Stop button is present
    await user.click(screen.getByLabelText("Stop recording"))
    await waitFor(() =>
      expect(sendVoiceSpy).toHaveBeenCalledWith("d", expect.any(Blob))
    )
  })
})
