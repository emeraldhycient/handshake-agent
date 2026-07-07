import { describe, expect, it } from "vitest"
import type {
  NotificationTemplate,
  TemplateVariable,
} from "@handshake-agent/contracts"

import {
  buildTemplateRef,
  buildUpsertBody,
  parseSampleVariables,
  type TemplateFormFields,
} from "./template-editor"

describe("parseSampleVariables", () => {
  it("returns an empty record for blank input", () => {
    expect(parseSampleVariables("  ")).toEqual({ ok: true, value: {} })
  })
  it("coerces object values to strings", () => {
    expect(parseSampleVariables('{"amount": 500, "name": "Ada"}')).toEqual({
      ok: true,
      value: { amount: "500", name: "Ada" },
    })
  })
  it("rejects a non-object JSON value", () => {
    expect(parseSampleVariables("[1,2]")).toEqual({
      ok: false,
      error: "Sample variables must be a JSON object.",
    })
  })
  it("rejects invalid JSON", () => {
    expect(parseSampleVariables("{not json")).toEqual({
      ok: false,
      error: "Sample variables is not valid JSON.",
    })
  })
})

const fields = (
  over: Partial<TemplateFormFields> = {}
): TemplateFormFields => ({
  templateKey: "kyc.approved",
  language: "en",
  channel: "whatsapp",
  subject: "",
  contentText: "Hi {{name}}",
  contentHtml: "",
  whatsappTemplateId: "",
  variables: [] as TemplateVariable[],
  ...over,
})

describe("buildUpsertBody", () => {
  it("omits blank optional fields", () => {
    const body = buildUpsertBody(fields())
    expect(body.templateKey).toBe("kyc.approved")
    expect(body.contentText).toBe("Hi {{name}}")
    expect("subject" in body).toBe(false)
    expect("contentHtml" in body).toBe(false)
    expect("whatsappTemplateId" in body).toBe(false)
  })
  it("includes optional fields when present", () => {
    const body = buildUpsertBody(
      fields({
        subject: "Welcome",
        contentHtml: "<b>Hi</b>",
        whatsappTemplateId: "wa-1",
      })
    )
    expect(body.subject).toBe("Welcome")
    expect(body.contentHtml).toBe("<b>Hi</b>")
    expect(body.whatsappTemplateId).toBe("wa-1")
  })
  it("throws on invalid input (empty required field)", () => {
    expect(() => buildUpsertBody(fields({ templateKey: "" }))).toThrow()
  })
})

describe("buildTemplateRef", () => {
  it("is null on create", () => {
    expect(buildTemplateRef(null)).toBeNull()
  })
  it("targets the immutable composite key on edit", () => {
    const template = {
      templateKey: "kyc.approved",
      language: "en",
      channel: "whatsapp",
    } as NotificationTemplate
    expect(buildTemplateRef(template)).toEqual({
      templateKey: "kyc.approved",
      language: "en",
      channel: "whatsapp",
    })
  })
})
