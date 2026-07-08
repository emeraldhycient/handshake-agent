/**
 * Local form schemas for the Settings dialogs, plus the pure mappers that turn
 * form values into the contracts request DTOs. The API clients re-parse every
 * body through the contracts schemas before sending — these exist only where a
 * form needs MORE than the DTO (confirm field, scope toggles, empty-means-skip).
 */
import { z } from "zod"
import {
  TransactionPinSchema,
  type CreatePatRequest,
  type PatScope,
  type UpdateProfileRequest,
} from "@handshake-agent/contracts"

// ─── Edit profile ─────────────────────────────────────────────────────────────

/** Same loose E.164 rule as UpdateProfileRequestSchema; "" means "no change". */
export const EditProfileFormSchema = z.object({
  phone: z
    .string()
    .regex(/^\+?[0-9]{8,15}$/, "Enter a valid phone number")
    .or(z.literal("")),
  fiatCurrency: z.string().min(1, "Choose a display currency"),
})
export type EditProfileFormValues = z.infer<typeof EditProfileFormSchema>

/**
 * Diff the form against the current profile into a PATCH body with only the
 * changed fields, or null when there is nothing to save. An empty phone is
 * "leave unchanged" — this surface never clears a phone.
 */
export function toUpdateProfileRequest(
  values: EditProfileFormValues,
  current: { phone: string | null; fiatCurrency: string }
): UpdateProfileRequest | null {
  const body: UpdateProfileRequest = {}
  const phone = values.phone.trim()
  if (phone && phone !== (current.phone ?? "")) body.phone = phone
  if (values.fiatCurrency && values.fiatCurrency !== current.fiatCurrency) {
    body.fiatCurrency = values.fiatCurrency
  }
  return body.phone === undefined && body.fiatCurrency === undefined
    ? null
    : body
}

// ─── Change PIN ───────────────────────────────────────────────────────────────

/**
 * Only the NEW pin is held to the policy schema — the current one is opaque
 * (the server verifies it through the lockout-protected PinService).
 */
export const ChangePinFormSchema = z
  .object({
    currentPin: z.string().min(1, "Enter your current PIN"),
    newPin: TransactionPinSchema,
    confirmNewPin: z.string(),
  })
  .refine((d) => d.newPin === d.confirmNewPin, {
    message: "PINs do not match",
    path: ["confirmNewPin"],
  })
export type ChangePinFormValues = z.infer<typeof ChangePinFormSchema>

// ─── Create personal access token ─────────────────────────────────────────────

export const CreateTokenFormSchema = z
  .object({
    label: z.string().trim().min(1, "Give this token a name").max(80),
    readScope: z.boolean(),
    proposeScope: z.boolean(),
    expiry: z.enum(["30", "90", "365", "never"]),
    pin: z.string().min(1, "Enter your transaction PIN"),
  })
  .refine((d) => d.readScope || d.proposeScope, {
    message: "Select at least one permission",
    path: ["readScope"],
  })
export type CreateTokenFormValues = z.infer<typeof CreateTokenFormSchema>

/** Map the form (toggles + expiry select) onto the contracts CreatePatRequest. */
export function toCreatePatRequest(
  values: CreateTokenFormValues
): CreatePatRequest {
  const scopes: PatScope[] = []
  if (values.readScope) scopes.push("read")
  if (values.proposeScope) scopes.push("chat:propose")
  return {
    label: values.label.trim(),
    pin: values.pin,
    scopes,
    ...(values.expiry === "never"
      ? {}
      : { expiresInDays: Number(values.expiry) }),
  }
}
