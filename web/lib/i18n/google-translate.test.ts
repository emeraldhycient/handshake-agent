import { describe, expect, it, beforeEach, vi } from "vitest"
import {
  installReactSafetyPatch,
  findTranslateCombo,
  applyLanguageToLivePage,
  resetToOriginal,
} from "./google-translate"
import { GOOGTRANS_COOKIE } from "./translate-cookie"

function clearCookies() {
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0]?.trim()
    if (name) document.cookie = `${name}=;max-age=0;path=/`
  }
}

describe("google-translate controls", () => {
  beforeEach(() => {
    clearCookies()
    localStorage.clear()
    document.body.innerHTML = ""
  })

  it("installReactSafetyPatch makes removeChild a no-op for foreign nodes", () => {
    installReactSafetyPatch()
    const a = document.createElement("div")
    const b = document.createElement("div")
    const orphan = document.createElement("span")
    a.appendChild(orphan)
    // Removing `orphan` from `b` (not its parent) would normally throw.
    expect(() => b.removeChild(orphan)).not.toThrow()
    // Legitimate removal still works.
    expect(() => a.removeChild(orphan)).not.toThrow()
    expect(a.contains(orphan)).toBe(false)
  })

  it("applyLanguageToLivePage drives the combo when present (no reload)", () => {
    const combo = document.createElement("select")
    combo.className = "goog-te-combo"
    const opt = document.createElement("option")
    opt.value = "fr"
    combo.appendChild(opt)
    document.body.appendChild(combo)
    const changed = vi.fn()
    combo.addEventListener("change", changed)
    const reload = vi.fn()

    applyLanguageToLivePage("fr", { reload })

    expect(document.cookie).toContain(`${GOOGTRANS_COOKIE}=/en/fr`)
    expect(combo.value).toBe("fr")
    expect(changed).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
  })

  it("applyLanguageToLivePage reloads when no combo exists", () => {
    const reload = vi.fn()
    applyLanguageToLivePage("de", { reload })
    expect(document.cookie).toContain(`${GOOGTRANS_COOKIE}=/en/de`)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("resetToOriginal clears the cookie and reloads", () => {
    document.cookie = `${GOOGTRANS_COOKIE}=/en/fr;path=/`
    const reload = vi.fn()
    resetToOriginal({ reload })
    expect(document.cookie).not.toContain(`${GOOGTRANS_COOKIE}=/en/fr`)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("findTranslateCombo returns null when absent", () => {
    expect(findTranslateCombo()).toBeNull()
  })
})
