import { cn } from "@/lib/utils"

/**
 * Circular selfie placeholder with a token-based stripe gradient (no hex — uses
 * color-mix over CSS custom properties).
 */
export function SelfieThumbnail() {
  return (
    <div
      className={cn(
        "flex h-11 w-11 flex-none items-end justify-center overflow-hidden rounded-full",
        "border border-border"
      )}
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, color-mix(in oklch, var(--border) 55%, var(--background)) 0 5px, var(--card-muted) 5px 10px)",
      }}
      aria-hidden
    >
      <span className="mb-1 font-mono text-[6px] font-bold tracking-wider text-muted-foreground uppercase">
        SELFIE
      </span>
    </div>
  )
}

export function PhoneIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="4.5"
        y="1.5"
        width="9"
        height="15"
        rx="2.2"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-primary"
      />
      <circle
        cx="9"
        cy="13.5"
        r="0.9"
        fill="currentColor"
        className="text-primary"
      />
    </svg>
  )
}

export function CardIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1.5"
        y="3.5"
        width="15"
        height="11"
        rx="2.2"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-primary"
      />
      <path
        d="M1.5 7h15"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-primary"
      />
    </svg>
  )
}

export function LockIcon() {
  return (
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
        className="text-muted-foreground"
      />
      <rect
        x="1.8"
        y="7"
        width="10.4"
        height="6.5"
        rx="2"
        fill="currentColor"
        className="text-muted-foreground"
      />
    </svg>
  )
}
