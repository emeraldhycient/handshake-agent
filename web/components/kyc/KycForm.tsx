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
import {
  KycCompleteRequestSchema,
  type KycCompleteRequest,
} from "@handshake-agent/contracts/dto"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useKycComplete } from "@/lib/query/kyc"
import type { KycFormProps } from "@/types/components"

// ─── Sub-schema: omit token (injected from props, not user-entered) ──────────
//
// We still pass token in the final payload — it just doesn't have its own
// visible field; the form schema for user-facing fields excludes it.
// The full KycCompleteRequestSchema is used in submitKycComplete for final parse.

export function KycForm({ token }: KycFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<KycCompleteRequest>({
    resolver: zodResolver(KycCompleteRequestSchema),
    defaultValues: { token },
  })

  const { mutateAsync, isPending, isSuccess, error } = useKycComplete()

  const loading = isSubmitting || isPending

  async function onSubmit(values: KycCompleteRequest) {
    // Wrap mutateAsync in try/catch so the rejection is handled here;
    // the error is captured in mutation.error and displayed in the UI.
    // This prevents an unhandled rejection from bubbling to the window.
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

      {/* NIN (optional) */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="kyc-nin"
          className="text-sm font-medium text-foreground"
        >
          NIN (National Identification Number){" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="kyc-nin"
          type="text"
          inputMode="numeric"
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
          autoComplete="new-password"
          aria-required="true"
          aria-invalid={!!errors.pin}
          aria-describedby={errors.pin ? "kyc-pin-error" : undefined}
          placeholder="Set a 4-digit PIN"
          maxLength={6}
          disabled={loading}
          {...register("pin")}
        />
        {errors.pin && (
          <p
            id="kyc-pin-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {errors.pin.message ?? "PIN is required"}
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
