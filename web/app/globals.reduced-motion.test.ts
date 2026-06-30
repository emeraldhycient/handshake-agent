import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"

/**
 * Guards the prefers-reduced-motion accessibility fix (CLAUDE.md §13.8).
 * globals.css must neutralize the hs-* keyframe animations (typing blink,
 * success ring/pop, message-in, scrim, spark) for users who opt out of motion.
 */
// vitest runs from the web package root; resolve the stylesheet from there.
const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8")

describe("globals.css — prefers-reduced-motion", () => {
  it("has a prefers-reduced-motion: reduce media query", () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  })

  it("cancels the hs-* animations under reduced motion", () => {
    const block = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)")
    )
    expect(block).toMatch(/animate-hs-/)
    expect(block).toMatch(/animation:\s*none/)
  })
})
