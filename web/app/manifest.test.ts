import { describe, expect, it } from "vitest"
import manifest from "./manifest"
import { BRAND, SITE_NAME, SITE_SHORT_NAME } from "@/lib/site"

describe("web app manifest", () => {
  const m = manifest()

  it("names the app and its home-screen short name", () => {
    expect(m.name).toBe(SITE_NAME)
    expect(m.short_name).toBe(SITE_SHORT_NAME)
    expect(m.description).toBeTruthy()
  })

  it("is an installable standalone app rooted at /", () => {
    expect(m.display).toBe("standalone")
    expect(m.start_url).toBe("/")
    expect(m.id).toBe("/")
    expect(m.scope).toBe("/")
  })

  it("uses the brand theme + background colours (hex, for splash + toolbar)", () => {
    expect(m.theme_color).toBe(BRAND.themeColor)
    expect(m.background_color).toBe(BRAND.backgroundColor)
    expect(m.lang).toBe("en")
  })

  it("declares 192 and 512 icons for both any and maskable purposes", () => {
    const icons = m.icons ?? []
    const has = (size: string, purpose: string) =>
      icons.some(
        (i) => i.sizes === size && (i.purpose ?? "any").includes(purpose)
      )
    expect(has("192x192", "any")).toBe(true)
    expect(has("512x512", "any")).toBe(true)
    expect(has("192x192", "maskable")).toBe(true)
    expect(has("512x512", "maskable")).toBe(true)
    // every icon points at a real PNG under /icons and declares its type
    for (const i of icons) {
      expect(i.src).toMatch(/^\/icons\/.+\.png$/)
      expect(i.type).toBe("image/png")
    }
  })
})
