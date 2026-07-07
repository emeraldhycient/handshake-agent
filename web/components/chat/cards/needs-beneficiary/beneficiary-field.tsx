import type { BeneficiaryFieldProps } from "@/types/chat"

/**
 * Compact labeled field used by the beneficiary add-forms. Intentionally NOT the
 * shared FormField — its type/colour scale (text-[12px]/text-warn) differs, and
 * this card must stay pixel-identical.
 */
export function BeneficiaryField({
  label,
  error,
  children,
}: BeneficiaryFieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-muted-foreground">
        {label}
      </span>
      {children}
      {error && (
        <span className="text-[11.5px] text-warn" role="alert">
          {error}
        </span>
      )}
    </label>
  )
}
