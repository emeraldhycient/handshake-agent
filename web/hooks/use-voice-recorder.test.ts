import { renderHook, act } from "@testing-library/react"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { useVoiceRecorder } from "./use-voice-recorder"

class FakeRecorder {
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  state = "inactive"
  constructor(
    public stream: unknown,
    public opts?: unknown
  ) {}
  start() {
    this.state = "recording"
  }
  stop() {
    this.state = "inactive"
    this.ondataavailable?.({ data: new Blob(["abc"], { type: "audio/webm" }) })
    this.onstop?.()
  }
}

describe("useVoiceRecorder", () => {
  beforeEach(() => {
    ;(globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder =
      FakeRecorder as unknown
    ;(
      FakeRecorder as unknown as { isTypeSupported: () => boolean }
    ).isTypeSupported = () => true
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
      },
    })
  })

  it("records and returns a Blob on stop", async () => {
    const { result } = renderHook(() => useVoiceRecorder())
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.status).toBe("recording")
    let blob: Blob | null = null
    await act(async () => {
      blob = await result.current.stop()
    })
    expect(blob).toBeInstanceOf(Blob)
    expect(result.current.status).toBe("idle")
  })

  it("reports denied when getUserMedia rejects", async () => {
    ;(
      globalThis.navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("denied"))
    const { result } = renderHook(() => useVoiceRecorder())
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.status).toBe("denied")
  })

  it("releases the mic track on cancel", async () => {
    const trackStop = vi.fn()
    ;(
      globalThis.navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({ getTracks: () => [{ stop: trackStop }] })
    const { result } = renderHook(() => useVoiceRecorder())
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.status).toBe("recording")
    act(() => {
      result.current.cancel()
    })
    expect(result.current.status).toBe("idle")
    expect(trackStop).toHaveBeenCalledTimes(1)
  })
})
