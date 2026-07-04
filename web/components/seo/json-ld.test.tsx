import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { JsonLd } from "./json-ld"

describe("JsonLd", () => {
  it("emits a parseable application/ld+json script", () => {
    const { container } = render(<JsonLd />)
    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script).not.toBeNull()
    const json = JSON.parse(script?.textContent ?? "")
    expect(json["@context"]).toBe("https://schema.org")
    expect(Array.isArray(json["@graph"])).toBe(true)
  })
})
