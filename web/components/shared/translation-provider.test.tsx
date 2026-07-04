import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// The npm widget injects Google's network script — stub it to a hidden marker.
vi.mock("next-google-translate-widget", () => ({
  default: () => <div data-testid="gt-engine" />,
}))

const applyLanguageToLivePage = vi.fn()
const resetToOriginal = vi.fn()
const installReactSafetyPatch = vi.fn()
vi.mock("@/lib/i18n/google-translate", () => ({
  applyLanguageToLivePage: (...a: unknown[]) => applyLanguageToLivePage(...a),
  resetToOriginal: (...a: unknown[]) => resetToOriginal(...a),
  installReactSafetyPatch: () => installReactSafetyPatch(),
}))

let stored: string | null = null
const setActiveLanguageCode = vi.fn()
vi.mock("@/lib/i18n/translate-cookie", () => ({
  getActiveLanguageCode: () => stored,
  setActiveLanguageCode: (...a: unknown[]) => setActiveLanguageCode(...a),
}))

vi.mock("@/lib/i18n/browser-language", () => ({
  detectBrowserLanguage: () => "de",
  readNavigatorLanguages: () => [],
}))

import { TranslationProvider, useTranslation } from "./translation-provider"

function Probe() {
  const { language, setLanguage, resetLanguage } = useTranslation()
  return (
    <div>
      <span data-testid="current">{language.code}</span>
      <button onClick={() => setLanguage("fr")}>set-fr</button>
      <button onClick={resetLanguage}>reset</button>
    </div>
  )
}

describe("TranslationProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stored = null
  })

  it("mounts the engine and installs the safety patch once", () => {
    render(
      <TranslationProvider>
        <Probe />
      </TranslationProvider>
    )
    expect(screen.getByTestId("gt-engine")).toBeInTheDocument()
    expect(installReactSafetyPatch).toHaveBeenCalledTimes(1)
  })

  it("applies the detected language on first visit when nothing is stored", () => {
    render(
      <TranslationProvider>
        <Probe />
      </TranslationProvider>
    )
    // detected "de" persisted (so Google reads it on engine init).
    expect(setActiveLanguageCode).toHaveBeenCalledWith("de")
    expect(screen.getByTestId("current")).toHaveTextContent("de")
  })

  it("prefers the stored language over detection", () => {
    stored = "es"
    render(
      <TranslationProvider>
        <Probe />
      </TranslationProvider>
    )
    expect(screen.getByTestId("current")).toHaveTextContent("es")
  })

  it("setLanguage drives the live page and updates context", async () => {
    const user = userEvent.setup()
    render(
      <TranslationProvider>
        <Probe />
      </TranslationProvider>
    )
    await user.click(screen.getByText("set-fr"))
    expect(applyLanguageToLivePage).toHaveBeenCalledWith("fr")
    expect(screen.getByTestId("current")).toHaveTextContent("fr")
  })

  it("resetLanguage resets to English", async () => {
    stored = "es"
    const user = userEvent.setup()
    render(
      <TranslationProvider>
        <Probe />
      </TranslationProvider>
    )
    await user.click(screen.getByText("reset"))
    expect(resetToOriginal).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("current")).toHaveTextContent("en")
  })
})
