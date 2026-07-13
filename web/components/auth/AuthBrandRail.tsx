import { BrandMark } from "@/components/shared/brand-mark"
import { cn } from "@/lib/utils"
import type { AuthBrandRailProps } from "@/types/auth"

/**
 * The desktop left brand rail for the auth surfaces (login) — the same green
 * gradient, logo + wordmark and encryption/compliance footer as the onboarding
 * wizard's rail, but static: no step-tracker (login is not a stepped wizard).
 * This gives /login visual parity with /get-started's email + OTP screens.
 */
export function AuthBrandRail({
  headline,
  subcopy,
  className,
}: AuthBrandRailProps) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col bg-[linear-gradient(168deg,var(--primary)_0%,var(--primary-deep)_100%)] px-10 py-11 text-primary-foreground",
        className
      )}
    >
      <div className="flex items-center gap-[11px]">
        <BrandMark size={40} />
        <span className="text-[17px] font-bold tracking-[-0.01em]">
          Handshake
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-center py-6">
        <h2 className="text-[32px] leading-[1.08] font-extrabold tracking-[-0.03em]">
          {headline}
        </h2>
        <p className="mt-3.5 max-w-[290px] text-[15px] leading-[1.5] text-primary-foreground/80">
          {subcopy}
        </p>
      </div>

      <div className="mt-6 flex items-center gap-2 text-primary-foreground/60">
        <svg
          width="14"
          height="15"
          viewBox="0 0 14 15"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3.5 7V5a3.5 3.5 0 017 0v2"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <rect
            x="1.8"
            y="7"
            width="10.4"
            height="6.5"
            rx="2"
            fill="currentColor"
          />
        </svg>
        <span className="text-xs">
          256-bit encryption · NDPR &amp; CBN compliant
        </span>
      </div>
    </div>
  )
}
