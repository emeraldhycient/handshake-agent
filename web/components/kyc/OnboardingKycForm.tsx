"use client"

/**
 * OnboardingKycForm — session-authenticated KYC onboarding orchestrator.
 *
 * Used on /onboarding by logged-in but unverified users. Collects the shared KYC
 * fields + a Confirm-PIN, and calls POST /kyc/submit (bearer auth via the Axios
 * interceptor). `confirmPin` is client-only and stripped before the mutation.
 *
 * The fields + success state are shared with KycForm (root §16, §13.2).
 */
import { useRouter } from "next/navigation"
import { useForm, FormProvider } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { FormAlert } from "@/components/shared/form-alert"
import { Button } from "@/components/ui/button"
import { KycFields } from "@/components/kyc/kyc-fields"
import { KycSubmitSuccess } from "@/components/kyc/kyc-submit-success"
import { useKycSubmit } from "@/lib/query/kyc"
import { kycBaseFields, hasNinOrBvn } from "@/lib/kyc/schema"
import { toErrorMessage } from "@/lib/error-message"

const OnboardingSchema = z
  .object({
    ...kycBaseFields,
    confirmPin: z.string().min(1, "Please confirm your PIN"),
  })
  .refine(hasNinOrBvn, { message: "Provide your NIN or BVN", path: ["nin"] })
  .refine((data) => data.pin === data.confirmPin, {
    message: "PINs do not match",
    path: ["confirmPin"],
  })

type OnboardingForm = z.infer<typeof OnboardingSchema>

export function OnboardingKycForm() {
  const router = useRouter()
  const methods = useForm<OnboardingForm>({
    resolver: zodResolver(OnboardingSchema),
  })
  const { mutateAsync, isPending, isSuccess, error } = useKycSubmit()
  const loading = methods.formState.isSubmitting || isPending

  async function onSubmit(values: OnboardingForm) {
    // Strip confirmPin before sending — it is client-side only.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { confirmPin, ...body } = values
    try {
      await mutateAsync(body)
      router.push("/")
    } catch {
      // Error surfaces via mutation.error — rendered as the FormAlert below.
    }
  }

  if (isSuccess) return <KycSubmitSuccess />

  const serverError = toErrorMessage(error)

  return (
    <FormProvider {...methods}>
      <form
        onSubmit={methods.handleSubmit(onSubmit)}
        noValidate
        aria-label="Identity verification form"
        className="flex flex-col gap-5"
      >
        {serverError && <FormAlert>{serverError}</FormAlert>}

        <KycFields
          idPrefix="onb"
          showConfirmPin
          dateOfBirthType="date"
          loading={loading}
        />

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
    </FormProvider>
  )
}
