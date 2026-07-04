import { afterEach, beforeEach, describe, expect, it } from "vitest"
import robots from "./robots"

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL

describe("robots.txt", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.ng"
  })
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL
  })

  it("allows crawling of the site root", () => {
    const rules = robots().rules
    const rule = Array.isArray(rules) ? rules[0] : rules
    expect(rule.allow).toBe("/")
  })

  it("disallows the API and token-bearing routes", () => {
    const rules = robots().rules
    const rule = Array.isArray(rules) ? rules[0] : rules
    const disallow = ([] as string[]).concat(rule.disallow ?? [])
    expect(disallow).toContain("/api/")
    expect(disallow).toContain("/verify-email")
  })

  it("points crawlers at the absolute sitemap + host", () => {
    const r = robots()
    expect(r.sitemap).toBe("https://app.example.ng/sitemap.xml")
    expect(r.host).toBe("https://app.example.ng")
  })
})
