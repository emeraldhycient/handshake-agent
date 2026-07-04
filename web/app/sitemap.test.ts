import { afterEach, beforeEach, describe, expect, it } from "vitest"
import sitemap from "./sitemap"

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL

describe("sitemap.xml", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.ng"
  })
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL
  })

  it("lists the public routes as absolute URLs", () => {
    const urls = sitemap().map((e) => e.url)
    // Root canonical carries the trailing slash (matches Next's canonical resolution).
    expect(urls).toContain("https://app.example.ng/")
    expect(urls).toContain("https://app.example.ng/download")
    expect(urls).toContain("https://app.example.ng/login")
    expect(urls).toContain("https://app.example.ng/signup")
    for (const u of urls) expect(u).toMatch(/^https:\/\//)
  })

  it("prioritises the home route highest", () => {
    const home = sitemap().find((e) => e.url === "https://app.example.ng/")
    expect(home?.priority).toBe(1)
  })
})
