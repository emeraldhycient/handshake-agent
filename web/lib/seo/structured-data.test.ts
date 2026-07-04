import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildStructuredData } from "./structured-data"
import { SITE_NAME } from "@/lib/site"

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL

describe("buildStructuredData (JSON-LD)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.ng"
  })
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL
  })

  it("uses the schema.org context and a typed @graph", () => {
    const data = buildStructuredData()
    expect(data["@context"]).toBe("https://schema.org")
    const types = data["@graph"].map((n) => n["@type"])
    expect(types).toContain("Organization")
    expect(types).toContain("WebSite")
    expect(types).toContain("WebApplication")
  })

  it("describes the org with the site name, url and logo", () => {
    const org = buildStructuredData()["@graph"].find(
      (n) => n["@type"] === "Organization"
    )
    expect(org?.name).toBe(SITE_NAME)
    expect(org?.url).toBe("https://app.example.ng")
    expect(org?.logo).toBe("https://app.example.ng/icons/icon-512.png")
  })

  it("marks the app as a free finance web application", () => {
    const app = buildStructuredData()["@graph"].find(
      (n) => n["@type"] === "WebApplication"
    )
    expect(app?.applicationCategory).toBe("FinanceApplication")
  })

  it("serialises cleanly (no circular refs)", () => {
    expect(() => JSON.stringify(buildStructuredData())).not.toThrow()
  })
})
