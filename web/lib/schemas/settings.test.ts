import { describe, expect, it } from "vitest"
import {
  ChangePinFormSchema,
  CreateTokenFormSchema,
  EditProfileFormSchema,
  toCreatePatRequest,
  toUpdateProfileRequest,
} from "./settings"

describe("EditProfileFormSchema", () => {
  it("accepts an empty phone (means 'no change')", () => {
    const parsed = EditProfileFormSchema.safeParse({
      phone: "",
      fiatCurrency: "NGN",
    })
    expect(parsed.success).toBe(true)
  })

  it("rejects a malformed phone", () => {
    const parsed = EditProfileFormSchema.safeParse({
      phone: "abc",
      fiatCurrency: "NGN",
    })
    expect(parsed.success).toBe(false)
  })

  it("accepts a +234 international phone", () => {
    const parsed = EditProfileFormSchema.safeParse({
      phone: "+2348012345678",
      fiatCurrency: "NGN",
    })
    expect(parsed.success).toBe(true)
  })
})

describe("toUpdateProfileRequest", () => {
  const current = { phone: "+2348012345678", fiatCurrency: "NGN" }

  it("returns only the fields that changed", () => {
    expect(
      toUpdateProfileRequest(
        { phone: "+2348012345678", fiatCurrency: "GHS" },
        current
      )
    ).toEqual({ fiatCurrency: "GHS" })
    expect(
      toUpdateProfileRequest(
        { phone: "+2347000000000", fiatCurrency: "NGN" },
        current
      )
    ).toEqual({ phone: "+2347000000000" })
  })

  it("returns null when nothing changed", () => {
    expect(
      toUpdateProfileRequest(
        { phone: "+2348012345678", fiatCurrency: "NGN" },
        current
      )
    ).toBeNull()
  })

  it("treats an empty phone as 'no change' (never clears the phone)", () => {
    expect(
      toUpdateProfileRequest({ phone: "", fiatCurrency: "NGN" }, current)
    ).toBeNull()
  })

  it("handles a user with no phone on file", () => {
    expect(
      toUpdateProfileRequest(
        { phone: "+2347000000000", fiatCurrency: "NGN" },
        { phone: null, fiatCurrency: "NGN" }
      )
    ).toEqual({ phone: "+2347000000000" })
  })
})

describe("ChangePinFormSchema", () => {
  it("rejects when the confirmation does not match", () => {
    const parsed = ChangePinFormSchema.safeParse({
      currentPin: "1234",
      newPin: "2468",
      confirmNewPin: "2469",
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toContain("confirmNewPin")
    }
  })

  it("rejects a weak new PIN (all same digit)", () => {
    const parsed = ChangePinFormSchema.safeParse({
      currentPin: "1234",
      newPin: "1111",
      confirmNewPin: "1111",
    })
    expect(parsed.success).toBe(false)
  })

  it("rejects a sequential new PIN", () => {
    const parsed = ChangePinFormSchema.safeParse({
      currentPin: "9999",
      newPin: "1234",
      confirmNewPin: "1234",
    })
    expect(parsed.success).toBe(false)
  })

  it("accepts a valid matching pair", () => {
    const parsed = ChangePinFormSchema.safeParse({
      currentPin: "1234",
      newPin: "2468",
      confirmNewPin: "2468",
    })
    expect(parsed.success).toBe(true)
  })

  it("requires the current PIN", () => {
    const parsed = ChangePinFormSchema.safeParse({
      currentPin: "",
      newPin: "2468",
      confirmNewPin: "2468",
    })
    expect(parsed.success).toBe(false)
  })
})

describe("CreateTokenFormSchema", () => {
  const base = {
    label: "My agent",
    readScope: true,
    proposeScope: true,
    expiry: "never",
    pin: "1234",
  }

  it("accepts the default (both scopes on, never expires)", () => {
    expect(CreateTokenFormSchema.safeParse(base).success).toBe(true)
  })

  it("rejects when both scopes are off", () => {
    const parsed = CreateTokenFormSchema.safeParse({
      ...base,
      readScope: false,
      proposeScope: false,
    })
    expect(parsed.success).toBe(false)
  })

  it("requires a label and a PIN", () => {
    expect(CreateTokenFormSchema.safeParse({ ...base, label: " " }).success).toBe(
      false
    )
    expect(CreateTokenFormSchema.safeParse({ ...base, pin: "" }).success).toBe(
      false
    )
  })
})

describe("toCreatePatRequest", () => {
  it("maps scope toggles to the contracts scopes array", () => {
    expect(
      toCreatePatRequest({
        label: "Agent",
        readScope: true,
        proposeScope: false,
        expiry: "never",
        pin: "1234",
      })
    ).toEqual({ label: "Agent", pin: "1234", scopes: ["read"] })
  })

  it("maps a day expiry to expiresInDays and trims the label", () => {
    expect(
      toCreatePatRequest({
        label: "  Claude  ",
        readScope: true,
        proposeScope: true,
        expiry: "90",
        pin: "1234",
      })
    ).toEqual({
      label: "Claude",
      pin: "1234",
      scopes: ["read", "chat:propose"],
      expiresInDays: 90,
    })
  })
})
