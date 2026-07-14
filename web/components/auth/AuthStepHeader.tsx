import type { AuthStepHeaderProps } from "@/types/auth"

/**
 * Shared header for the login steps. On DESKTOP it carries the full eyebrow +
 * heading + supporting line (the green brand rail sits alongside). On MOBILE
 * the login page renders a green brand band up top that carries the brand +
 * "Welcome back." headline, so this header drops the (now duplicate) heading
 * and keeps only the eyebrow + supporting line beneath the band.
 */
export function AuthStepHeader({
  eyebrow,
  heading,
  subcopy,
}: AuthStepHeaderProps) {
  return (
    <div>
      <p className="text-[13px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-2 hidden text-3xl leading-[1.1] font-extrabold tracking-[-0.028em] text-foreground lg:block">
        {heading}
      </h1>
      <p className="mt-[9px] text-[15px] leading-[1.45] text-muted-foreground">
        {subcopy}
      </p>
    </div>
  )
}
