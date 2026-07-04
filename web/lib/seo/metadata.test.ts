import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildRootMetadata, rootViewport } from "./metadata"
import { SITE_NAME, SITE_SHORT_NAME } from "@/lib/site"

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL

describe("buildRootMetadata", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.ng"
  })
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL
  })

  it("sets metadataBase so relative canonical/OG URLs resolve absolutely", () => {
    const base = buildRootMetadata().metadataBase as URL
    expect(base.href).toBe("https://app.example.ng/")
  })

  it("uses a title template built around the product name", () => {
    const title = buildRootMetadata().title
    expect(title).toMatchObject({ default: SITE_NAME })
    expect((title as { template: string }).template).toContain(SITE_NAME)
  })

  it("links the manifest and a self-referential canonical", () => {
    const m = buildRootMetadata()
    expect(m.manifest).toBe("/manifest.webmanifest")
    expect(m.alternates?.canonical).toBe("/")
  })

  it("declares Open Graph + Twitter cards", () => {
    const m = buildRootMetadata()
    expect(m.openGraph?.siteName).toBe(SITE_NAME)
    expect((m.openGraph as { type?: string })?.type).toBe("website")
    expect((m.twitter as { card?: string })?.card).toBe("summary_large_image")
  })

  it("is indexable and iOS-installable", () => {
    const m = buildRootMetadata()
    expect((m.robots as { index?: boolean })?.index).toBe(true)
    expect(m.appleWebApp).toMatchObject({
      capable: true,
      title: SITE_SHORT_NAME,
    })
  })

  it("advertises the SVG + apple-touch icons", () => {
    const icons = buildRootMetadata().icons as {
      icon?: unknown[]
      apple?: unknown[]
    }
    expect(JSON.stringify(icons.icon)).toContain("/icon.svg")
    expect(JSON.stringify(icons.apple)).toContain("apple-touch-icon.png")
  })
})

describe("rootViewport", () => {
  it("sets a theme colour and covers the notch", () => {
    expect(rootViewport.themeColor).toBeTruthy()
    expect(rootViewport.viewportFit).toBe("cover")
  })
})
