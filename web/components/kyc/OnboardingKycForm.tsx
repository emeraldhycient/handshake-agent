"use client"

/**
 * OnboardingKycForm — session-authenticated KYC onboarding form.
 *
 * Used on the /onboarding route by logged-in but unverified users.
 * Collects KYC details + PIN (with confirmation) and calls POST /kyc/submit
 * (bearer auth handled by the Axios interceptor — no token field in this form).
 *
 * Form schema is a superset of KycSubmitRequestSchema: adds `confirmPin` for
 * client-side match validation. `confirmPin` is stripped before the mutation.
 *
 * Strict layering: pure UI — no fetch, no axios import, no business logic.
 *
 * a11y: visible labels, error text linked via aria-describedby, focus states
 * via Tailwind tokens, keyboard-navigable (no tabIndex tricks).
 */
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { KycSubmitRequestSchema } from "@handshake-agent/contracts/dto"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useKycSubmit } from "@/lib/query/kyc"

// ─── Extended schema: KycSubmitRequest fields + confirmPin ────────────────────
//
// `confirmPin` is validated client-side only and stripped before the request.
// The `.refine` keeps the error on the `confirmPin` field for accessible linking.

const OnboardingSchema = KycSubmitRequestSchema.extend({
  confirmPin: z.string().min(1, "Please confirm your PIN"),
}).refine((data) => data.pin === data.confirmPin, {
  message: "PINs do not match",
  path: ["confirmPin"],
})

type OnboardingForm = z.infer<typeof OnboardingSchema>

// ─── Component ────────────────────────────────────────────────────────────────

export function OnboardingKycForm() {
  const router = useRouter()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingForm>({
    resolver: zodResolver(OnboardingSchema),
  })

  const { mutateAsync, isPending, isSuccess, error } = useKycSubmit()

  const loading = isSubmitting || isPending

  async function onSubmit(values: OnboardingForm) {
    // Strip confirmPin before sending — it is client-side only.
    const { confirmPin: _confirmPin, ...body } = values
    try {
      await mutateAsync(body)
      router.push("/")
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
          Your identity has been submitted for review. You will be notified once
          verification is complete.
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
          htmlFor="onb-firstName"
          className="text-sm font-medium text-foreground"
        >
          First name
        </label>
        <Input
          id="onb-firstName"
          type="text"
          autoComplete="given-name"
          aria-required="true"
          aria-invalid={!!errors.firstName}
          aria-describedby={
            errors.firstName ? "onb-firstName-error" : undefined
          }
          placeholder="e.g. Amara"
          disabled={loading}
          {...register("firstName")}
        />
        {errors.firstName && (
          <p
            id="onb-firstName-error"
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
          htmlFor="onb-lastName"
          className="text-sm font-medium text-foreground"
        >
          Last name
        </label>
        <Input
          id="onb-lastName"
          type="text"
          autoComplete="family-name"
          aria-required="true"
          aria-invalid={!!errors.lastName}
          aria-describedby={errors.lastName ? "onb-lastName-error" : undefined}
          placeholder="e.g. Okafor"
          disabled={loading}
          {...register("lastName")}
        />
        {errors.lastName && (
          <p
            id="onb-lastName-error"
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
          htmlFor="onb-dateOfBirth"
          className="text-sm font-medium text-foreground"
        >
          Date of birth{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="onb-dateOfBirth"
          type="date"
          autoComplete="bday"
          aria-invalid={!!errors.dateOfBirth}
          aria-describedby={
            errors.dateOfBirth ? "onb-dateOfBirth-error" : undefined
          }
          disabled={loading}
          {...register("dateOfBirth")}
        />
        {errors.dateOfBirth && (
          <p
            id="onb-dateOfBirth-error"
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
          htmlFor="onb-bvn"
          className="text-sm font-medium text-foreground"
        >
          BVN (Bank Verification Number){" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="onb-bvn"
          type="text"
          inputMode="numeric"
          aria-invalid={!!errors.bvn}
          aria-describedby={errors.bvn ? "onb-bvn-error" : undefined}
          placeholder="11-digit BVN"
          disabled={loading}
          {...register("bvn")}
        />
        {errors.bvn && (
          <p
            id="onb-bvn-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {errors.bvn.message}
          </p>
        )}
      </div>

      {/* NIN */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="onb-nin"
          className="text-sm font-medium text-foreground"
        >
          NIN (National Identification Number){" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="onb-nin"
          type="text"
          inputMode="numeric"
          aria-invalid={!!errors.nin}
          aria-describedby={errors.nin ? "onb-nin-error" : undefined}
          placeholder="11-digit NIN"
          disabled={loading}
          {...register("nin")}
        />
        {errors.nin && (
          <p
            id="onb-nin-error"
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
          htmlFor="onb-pin"
          className="text-sm font-medium text-foreground"
        >
          Transaction PIN
        </label>
        <Input
          id="onb-pin"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          aria-required="true"
          aria-invalid={!!errors.pin}
          aria-describedby={errors.pin ? "onb-pin-error" : undefined}
          placeholder="Set a 4–6 digit PIN"
          maxLength={6}
          disabled={loading}
          {...register("pin")}
        />
        {errors.pin && (
          <p
            id="onb-pin-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {errors.pin.message ?? "PIN is required"}
          </p>
        )}
      </div>

      {/* Confirm PIN */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="onb-confirmPin"
          className="text-sm font-medium text-foreground"
        >
          Confirm PIN
        </label>
        <Input
          id="onb-confirmPin"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          aria-required="true"
          aria-invalid={!!errors.confirmPin}
          aria-describedby={
            errors.confirmPin ? "onb-confirmPin-error" : undefined
          }
          placeholder="Re-enter your PIN"
          maxLength={6}
          disabled={loading}
          {...register("confirmPin")}
        />
        {errors.confirmPin && (
          <p
            id="onb-confirmPin-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {errors.confirmPin.message ?? "Please confirm your PIN"}
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
