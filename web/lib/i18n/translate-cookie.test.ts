import { describe, expect, it, beforeEach } from "vitest"
import {
  setActiveLanguageCode,
  clearActiveLanguage,
  getActiveLanguageCode,
  GOOGTRANS_COOKIE,
  LANG_STORAGE_KEY,
} from "./translate-cookie"

function clearCookies() {
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0]?.trim()
    if (name) document.cookie = `${name}=;max-age=0;path=/`
  }
}

describe("translate-cookie", () => {
  beforeEach(() => {
    clearCookies()
    localStorage.clear()
  })

  it("writes the googtrans cookie as /en/<code> and mirrors to localStorage", () => {
    setActiveLanguageCode("fr")
    expect(document.cookie).toContain(`${GOOGTRANS_COOKIE}=/en/fr`)
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe("fr")
  })

  it("reads the mirror first", () => {
    localStorage.setItem(LANG_STORAGE_KEY, "de")
    expect(getActiveLanguageCode()).toBe("de")
  })

  it("falls back to parsing the cookie target when no mirror", () => {
    localStorage.clear()
    document.cookie = `${GOOGTRANS_COOKIE}=/en/es;path=/`
    expect(getActiveLanguageCode()).toBe("es")
  })

  it("returns null when nothing is set", () => {
    expect(getActiveLanguageCode()).toBeNull()
  })

  it("clear removes the cookie and the mirror", () => {
    setActiveLanguageCode("fr")
    clearActiveLanguage()
    expect(document.cookie).not.toContain(`${GOOGTRANS_COOKIE}=/en/fr`)
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBeNull()
    expect(getActiveLanguageCode()).toBeNull()
  })
})
