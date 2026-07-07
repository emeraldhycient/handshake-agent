import { describe, expect, it } from "vitest"
import { buildGreeting, greetingPrefix } from "./greeting"

describe("greeting", () => {
  it("greetingPrefix returns a Good <time> phrase", () => {
    expect(greetingPrefix()).toMatch(/^Good (morning|afternoon|evening)$/)
  })

  it("greets by first name when a name is known", () => {
    expect(buildGreeting("Amara", "Okafor")).toMatch(
      /^Good (morning|afternoon|evening), Amara$/
    )
  })

  it("falls back to the last name when there is no first name", () => {
    expect(buildGreeting(null, "Okafor")).toMatch(/, Okafor$/)
  })

  it("omits the name entirely when none is known", () => {
    expect(buildGreeting(null, undefined)).toMatch(
      /^Good (morning|afternoon|evening)$/
    )
  })
})
