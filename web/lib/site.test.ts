import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  absoluteUrl,
  BRAND,
  getSiteUrl,
  SITE_NAME,
  SITE_SHORT_NAME,
} from "./site"

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL

function restoreEnv() {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL
}

describe("getSiteUrl", () => {
  afterEach(restoreEnv)

  it("falls back to localhost when NEXT_PUBLIC_SITE_URL is unset", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL
    expect(getSiteUrl()).toBe("http://localhost:3000")
  })

  it("uses NEXT_PUBLIC_SITE_URL when set", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.ng"
    expect(getSiteUrl()).toBe("https://app.example.ng")
  })

  it("strips a trailing slash so joins never double up", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.ng/"
    expect(getSiteUrl()).toBe("https://app.example.ng")
  })
})

describe("absoluteUrl", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.ng"
  })
  afterEach(restoreEnv)

  it("joins an absolute path onto the origin", () => {
    expect(absoluteUrl("/download")).toBe("https://app.example.ng/download")
  })

  it("adds a leading slash when the path lacks one", () => {
    expect(absoluteUrl("download")).toBe("https://app.example.ng/download")
  })

  it("returns the bare origin for an empty path", () => {
    expect(absoluteUrl()).toBe("https://app.example.ng")
  })
})

describe("brand identity constants", () => {
  it("exposes the product and short names", () => {
    expect(SITE_NAME).toBe("Handshake Agent")
    expect(SITE_SHORT_NAME).toBe("Handshake")
  })

  it("exposes hex brand colors for the manifest (no oklch — manifest needs hex)", () => {
    expect(BRAND.themeColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(BRAND.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(BRAND.accent).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
