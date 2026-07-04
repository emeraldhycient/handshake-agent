import { describe, expect, it } from "vitest"

import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE_CODE,
  findLanguage,
} from "./languages"

describe("SUPPORTED_LANGUAGES", () => {
  it("includes English as the default", () => {
    expect(DEFAULT_LANGUAGE_CODE).toBe("en")
    expect(SUPPORTED_LANGUAGES.some((l) => l.code === "en")).toBe(true)
  })

  it("has at least 100 languages (the 'full Google list')", () => {
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(100)
  })

  it("has unique, non-empty codes and names for every entry", () => {
    const codes = new Set<string>()
    for (const l of SUPPORTED_LANGUAGES) {
      expect(l.code.trim()).not.toBe("")
      expect(l.englishName.trim()).not.toBe("")
      expect(l.nativeName.trim()).not.toBe("")
      expect(codes.has(l.code)).toBe(false)
      codes.add(l.code)
    }
  })

  it("uses the Google widget legacy codes (iw, jw, tl, zh-CN, zh-TW)", () => {
    for (const code of ["iw", "jw", "tl", "zh-CN", "zh-TW"]) {
      expect(SUPPORTED_LANGUAGES.some((l) => l.code === code)).toBe(true)
    }
    // Guard against the modern aliases sneaking in as duplicates.
    expect(SUPPORTED_LANGUAGES.some((l) => l.code === "he")).toBe(false)
    expect(SUPPORTED_LANGUAGES.some((l) => l.code === "jv")).toBe(false)
  })

  it("findLanguage returns the entry or undefined", () => {
    expect(findLanguage("fr")?.englishName).toBe("French")
    expect(findLanguage("zz-NOPE")).toBeUndefined()
  })
})
