"use client"

/**
 * KycForm — feature component for the /kyc web-handoff page.
 *
 * Collects exactly the fields that /kyc/complete validates (from contracts):
 *   token, firstName, lastName, dateOfBirth, bvn, nin (optional), pin.
 *
 * Strict layering: this component is pure UI.
 *   - Form wiring: react-hook-form + zodResolver (contracts schema)
 *   - Data mutation: useKycComplete hook (lib/query/kyc)
 *   - No fetch, no axios import, no business logic here.
 *
 * a11y: visible labels, error text linked via aria-describedby, focus states
 * via Tailwind tokens, keyboard-navigable (no tabIndex tricks).
 */
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  BvnSchema,
  NinSchema,
  TransactionPinSchema,
} from "@handshake-agent/contracts/dto"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useKycComplete } from "@/lib/query/kyc"
import type { KycFormProps } from "@/types/components"

// ─── Form schema — built from the contract's canonical field schemas ──────────
//
// PIN strength (TransactionPinSchema) and the 11-digit NIN/BVN format come
// straight from @handshake-agent/contracts so the FE (UX) gate and the server
// (security boundary, §3.3) validate identically. `token` is injected from
// props, not user-entered. Empty identifier strings are coerced to `undefined`
// so a blank field surfaces the "provide your NIN or BVN" rule rather than a
// 11-digit format error.

const optionalIdentifier = (schema: z.ZodString) =>
  z
    .union([z.literal(""), schema])
    .optional()
    .transform((v) => (v === "" ? undefined : v))

const KycFormSchema = z
  .object({
    token: z.string().min(1),
    nin: optionalIdentifier(NinSchema),
    bvn: optionalIdentifier(BvnSchema),
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    dateOfBirth: z.string().optional(),
    pin: TransactionPinSchema,
  })
  .refine((data) => Boolean(data.nin) || Boolean(data.bvn), {
    message: "Provide your NIN or BVN",
    path: ["nin"],
  })

type KycFormValues = z.infer<typeof KycFormSchema>

export function KycForm({ token }: KycFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<KycFormValues>({
    resolver: zodResolver(KycFormSchema),
    defaultValues: { token },
  })

  const { mutateAsync, isPending, isSuccess, error } = useKycComplete()

  const loading = isSubmitting || isPending

  async function onSubmit(values: KycFormValues) {
    // Wrap mutateAsync in try/catch so the rejection is handled here;
    // the error is captured in mutation.error and displayed in the UI.
    // This prevents an unhandled rejection from bubbling to the window.
    // Blank NIN/BVN are already coerced to `undefined` by the schema transform.
    try {
      await mutateAsync({ ...values, token })
    } catch {
      // Intentionally swallowing here: the error surfaces via mutation.error
      // which is rendered as the server-error alert. Never silently drop
      // the display — that's handled in the JSX below.
    }
  }

  // ─── Success state ──────────────────────────────────────────────────────────

  if (isSuccess) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-4 rounded-xl border border-success bg-success-muted px-6 py-10 text-center"
      >
        <span className="text-4xl" aria-hidden="true">
          ✓
        </span>
        <h2 className="text-lg font-semibold text-success-foreground">
          Verification submitted
        </h2>
        <p className="text-sm text-muted-foreground">
          Your identity has been submitted for review. We will notify you once
          verification is complete.
        </p>
        <p className="mt-2 text-sm font-medium text-foreground">
          Return to WhatsApp to continue.
        </p>
      </div>
    )
  }

  // ─── Form state (loading / error / data) ───────────────────────────────────

  const serverError =
    error instanceof Error ? error.message : error ? String(error) : null

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Identity verification form"
      className="flex flex-col gap-5"
    >
      {/* Server error — surfaced, never swallowed */}
      {serverError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {serverError}
        </div>
      )}

      {/* First name */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="kyc-firstName"
          className="text-sm font-medium text-foreground"
        >
          First name
        </label>
        <Input
          id="kyc-firstName"
          type="text"
          autoComplete="given-name"
          aria-required="true"
          aria-invalid={!!errors.firstName}
          aria-describedby={
            errors.firstName ? "kyc-firstName-error" : undefined
          }
          placeholder="e.g. Amara"
          disabled={loading}
          {...register("firstName")}
        />
        {errors.firstName && (
          <p
            id="kyc-firstName-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {errors.firstName.message ?? "First name is required"}
          </p>
        )}
      </div>

      {/* Last name */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="kyc-lastName"
          className="text-sm font-medium text-foreground"
        >
          Last name
        </label>
        <Input
          id="kyc-lastName"
          type="text"
          autoComplete="family-name"
          aria-required="true"
          aria-invalid={!!errors.lastName}
          aria-describedby={errors.lastName ? "kyc-lastName-error" : undefined}
          placeholder="e.g. Okafor"
          disabled={loading}
          {...register("lastName")}
        />
        {errors.lastName && (
          <p
            id="kyc-lastName-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {errors.lastName.message ?? "Last name is required"}
          </p>
        )}
      </div>

      {/* Date of birth */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="kyc-dateOfBirth"
          className="text-sm font-medium text-foreground"
        >
          Date of birth
        </label>
        <Input
          id="kyc-dateOfBirth"
          type="text"
          inputMode="numeric"
          autoComplete="bday"
          aria-invalid={!!errors.dateOfBirth}
          aria-describedby={
            errors.dateOfBirth ? "kyc-dateOfBirth-error" : undefined
          }
          placeholder="YYYY-MM-DD"
          disabled={loading}
          {...register("dateOfBirth")}
        />
        {errors.dateOfBirth && (
          <p
            id="kyc-dateOfBirth-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {errors.dateOfBirth.message}
          </p>
        )}
      </div>

      {/* Identity — at least one of NIN or BVN is required by the provider. */}
      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="text-sm font-medium text-foreground">
          NIN or BVN{" "}
          <span className="font-normal text-muted-foreground">
            (at least one required)
          </span>
        </legend>
        <p className="text-xs text-muted-foreground">
          Enter your 11-digit National Identification Number (NIN) or Bank
          Verification Number (BVN). You only need to provide one.
        </p>

        {/* NIN */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="kyc-nin"
            className="text-sm font-medium text-foreground"
          >
            NIN (National Identification Number)
          </label>
          <Input
            id="kyc-nin"
            type="text"
            inputMode="numeric"
            pattern="\d{11}"
            maxLength={11}
            aria-invalid={!!errors.nin}
            aria-describedby={errors.nin ? "kyc-nin-error" : undefined}
            placeholder="11-digit NIN"
            disabled={loading}
            {...register("nin")}
          />
          {errors.nin && (
            <p
              id="kyc-nin-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {errors.nin.message}
            </p>
          )}
        </div>

        {/* BVN */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="kyc-bvn"
            className="text-sm font-medium text-foreground"
          >
            BVN (Bank Verification Number)
          </label>
          <Input
            id="kyc-bvn"
            type="text"
            inputMode="numeric"
            pattern="\d{11}"
            maxLength={11}
            aria-invalid={!!errors.bvn}
            aria-describedby={errors.bvn ? "kyc-bvn-error" : undefined}
            placeholder="11-digit BVN"
            disabled={loading}
            {...register("bvn")}
          />
          {errors.bvn && (
            <p
              id="kyc-bvn-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {errors.bvn.message}
            </p>
          )}
        </div>
      </fieldset>

      {/* PIN — type password so it is never visible / logged */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="kyc-pin"
          className="text-sm font-medium text-foreground"
        >
          Transaction PIN
        </label>
        <Input
          id="kyc-pin"
          type="password"
          inputMode="numeric"
          pattern="\d{4,6}"
          autoComplete="new-password"
          aria-required="true"
          aria-invalid={!!errors.pin}
          aria-describedby={errors.pin ? "kyc-pin-error" : "kyc-pin-hint"}
          placeholder="Set a 4–6 digit PIN"
          minLength={4}
          maxLength={6}
          disabled={loading}
          {...register("pin")}
        />
        {errors.pin ? (
          <p
            id="kyc-pin-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {errors.pin.message ?? "PIN is required"}
          </p>
        ) : (
          <p id="kyc-pin-hint" className="text-xs text-muted-foreground">
            4–6 digits. Avoid repeated digits (1111) or sequences (1234).
          </p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={loading}
        aria-busy={loading}
        className="mt-2 w-full"
      >
        {loading ? "Submitting…" : "Submit verification"}
      </Button>
    </form>
  )
}
