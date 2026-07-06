"use client"

/**
 * KycForm — orchestrator for the /kyc web-handoff page.
 *
 * Collects the fields /kyc/complete validates: token (from props, hidden),
 * firstName, lastName, dateOfBirth, bvn, nin (optional), pin. Fields + success
 * state are shared with OnboardingKycForm (root §16, §13.2).
 *
 * Strict layering: pure UI — no fetch, no axios, no business logic.
 */
import { useForm, FormProvider } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { FormAlert } from "@/components/shared/form-alert"
import { Button } from "@/components/ui/button"
import { KycFields } from "@/components/kyc/kyc-fields"
import { KycSubmitSuccess } from "@/components/kyc/kyc-submit-success"
import { useKycComplete } from "@/lib/query/kyc"
import { kycBaseFields, hasNinOrBvn } from "@/lib/kyc/schema"
import { toErrorMessage } from "@/lib/error-message"
import type { KycFormProps } from "@/types/components"

const KycFormSchema = z
  .object({ token: z.string().min(1), ...kycBaseFields })
  .refine(hasNinOrBvn, { message: "Provide your NIN or BVN", path: ["nin"] })

type KycFormValues = z.infer<typeof KycFormSchema>

export function KycForm({ token }: KycFormProps) {
  const methods = useForm<KycFormValues>({
    resolver: zodResolver(KycFormSchema),
    defaultValues: { token },
  })
  const { mutateAsync, isPending, isSuccess, error } = useKycComplete()
  const loading = methods.formState.isSubmitting || isPending

  async function onSubmit(values: KycFormValues) {
    try {
      await mutateAsync({ ...values, token })
    } catch {
      // Error surfaces via mutation.error — rendered as the FormAlert below.
    }
  }

  if (isSuccess) return <KycSubmitSuccess returnToWhatsApp />

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

        <KycFields idPrefix="kyc" dateOfBirthType="text" loading={loading} />

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
