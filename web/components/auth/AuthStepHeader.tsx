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
        <p className="text-[13px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
          {eyebrow}
        </p>
      </div>
      <h1 className="mt-2 text-[27px] leading-[1.1] font-extrabold tracking-[-0.028em] text-foreground lg:text-3xl">
        {heading}
      </h1>
      <p className="mt-[9px] text-[15px] leading-[1.45] text-muted-foreground">
        {subcopy}
      </p>
    </div>
  )
}
