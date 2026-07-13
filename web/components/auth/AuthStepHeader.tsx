import { BrandMark } from "@/components/shared/brand-mark"
import type { AuthStepHeaderProps } from "@/types/auth"

/**
 * Shared header for the login steps — mirrors the onboarding wizard's step
 * header (mobile BrandMark + uppercase eyebrow, then a bold heading and
 * supporting line) so /login reads as the same family as /get-started.
 */
export function AuthStepHeader({
  eyebrow,
  heading,
  subcopy,
}: AuthStepHeaderProps) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <BrandMark size={40} className="lg:hidden" />
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {eyebrow}
        </p>
      </div>
      <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground lg:text-3xl">
        {heading}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground lg:text-base">
        {subcopy}
      </p>
    </div>
  )
}
