import { describe, expect, it } from "vitest"
import {
  detectBrowserLanguage,
  readNavigatorLanguages,
} from "./browser-language"

describe("detectBrowserLanguage", () => {
  it("matches an exact supported code", () => {
    expect(detectBrowserLanguage(["fr"])).toBe("fr")
  })

  it("strips the region subtag (pt-BR -> pt)", () => {
    expect(detectBrowserLanguage(["pt-BR"])).toBe("pt")
    expect(detectBrowserLanguage(["fr-CA"])).toBe("fr")
  })

  it("maps browser aliases to Google's legacy codes", () => {
    expect(detectBrowserLanguage(["he-IL"])).toBe("iw") // Hebrew
    expect(detectBrowserLanguage(["jv"])).toBe("jw") // Javanese
    expect(detectBrowserLanguage(["fil"])).toBe("tl") // Filipino
    expect(detectBrowserLanguage(["in"])).toBe("id") // legacy Indonesian
    expect(detectBrowserLanguage(["nb-NO"])).toBe("no") // Norwegian Bokmål
  })

  it("resolves Chinese variants", () => {
    expect(detectBrowserLanguage(["zh-TW"])).toBe("zh-TW")
    expect(detectBrowserLanguage(["zh-Hant-HK"])).toBe("zh-TW")
    expect(detectBrowserLanguage(["zh-CN"])).toBe("zh-CN")
    expect(detectBrowserLanguage(["zh"])).toBe("zh-CN")
  })

  it("prefers the first supported entry in the preference list", () => {
    expect(detectBrowserLanguage(["zz", "de", "fr"])).toBe("de")
  })

  it("falls back to English for unsupported or empty input", () => {
    expect(detectBrowserLanguage(["zz-ZZ"])).toBe("en")
    expect(detectBrowserLanguage([])).toBe("en")
  })
})

describe("readNavigatorLanguages", () => {
  it("returns an array (jsdom's navigator.languages, possibly empty)", () => {
    expect(Array.isArray(readNavigatorLanguages())).toBe(true)
  })
})
