import {
  AmlRuleCreateRequestSchema,
  AmlRuleUpdateRequestSchema,
  type AmlRule,
  type AmlRuleCreateRequest,
  type AmlRuleUpdateRequest,
} from "@handshake-agent/contracts"

/** The editable rule fields (parameters is edited as raw JSON, parsed before build). */
export interface AmlRuleFormFields {
  ruleKey: string
  name: string
  description: string
  ruleType: AmlRule["ruleType"]
  action: AmlRule["action"]
  enabled: boolean
  parameters: Record<string, unknown>
}

/** Parse the parameters textarea into a JSON object; a non-object or bad JSON errors. */
export function parseParameters(
  raw: string
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return { ok: false, error: "Parameters must be a JSON object." }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, error: "Parameters is not valid JSON." }
  }
}

/** Validate the full create body (ruleKey + ruleType included). Throws on invalid input. */
export function buildCreateBody(
  fields: AmlRuleFormFields
): AmlRuleCreateRequest {
  return AmlRuleCreateRequestSchema.parse({
    ruleKey: fields.ruleKey,
    name: fields.name,
    description: fields.description,
    ruleType: fields.ruleType,
    action: fields.action,
    enabled: fields.enabled,
    parameters: fields.parameters,
  })
}

/** Validate the edit body — only the mutable fields (ruleKey + ruleType are immutable). */
export function buildUpdateBody(
  fields: AmlRuleFormFields
): AmlRuleUpdateRequest {
  return AmlRuleUpdateRequestSchema.parse({
    name: fields.name,
    description: fields.description,
    action: fields.action,
    enabled: fields.enabled,
    parameters: fields.parameters,
  })
}
