import { describe, expect, it } from "vitest"

import {
  buildCreateBody,
  buildUpdateBody,
  parseParameters,
  type AmlRuleFormFields,
} from "./aml-rule"
import { RULE_TYPES, ACTIONS } from "@/constants/aml-rule"

describe("parseParameters", () => {
  it("parses a JSON object", () => {
    expect(parseParameters('{"threshold": 5}')).toEqual({
      ok: true,
      value: { threshold: 5 },
    })
  })
  it("rejects a non-object", () => {
    expect(parseParameters("[1,2]")).toEqual({
      ok: false,
      error: "Parameters must be a JSON object.",
    })
  })
  it("rejects invalid JSON", () => {
    expect(parseParameters("{nope")).toEqual({
      ok: false,
      error: "Parameters is not valid JSON.",
    })
  })
})

const fields = (over: Partial<AmlRuleFormFields> = {}): AmlRuleFormFields => ({
  ruleKey: "velocity.daily_amount",
  name: "Daily amount cap",
  description: "Flag large daily volume",
  ruleType: RULE_TYPES[0],
  action: ACTIONS[0],
  enabled: true,
  parameters: { threshold: 5 },
  ...over,
})

describe("buildCreateBody", () => {
  it("includes ruleKey + ruleType", () => {
    const body = buildCreateBody(fields())
    expect(body.ruleKey).toBe("velocity.daily_amount")
    expect(body.ruleType).toBe(RULE_TYPES[0])
    expect(body.parameters).toEqual({ threshold: 5 })
  })
  it("throws on an out-of-enum action", () => {
    expect(() =>
      buildCreateBody(
        fields({ action: "nonsense" as AmlRuleFormFields["action"] })
      )
    ).toThrow()
  })
})

describe("buildUpdateBody", () => {
  it("omits the immutable ruleKey + ruleType", () => {
    const body = buildUpdateBody(fields())
    expect("ruleKey" in body).toBe(false)
    expect("ruleType" in body).toBe(false)
    expect(body.name).toBe("Daily amount cap")
    expect(body.enabled).toBe(true)
  })
})
