import type { ReadinessIconProps } from "@/types"

/** The MOCK-MODE banner's warning triangle (design 24×24 path). */
export function WarningTriangleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-twn"
    >
      <path
        d="M12 4l9 16H3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The readiness-row glyph — a check when done, a dash while pending. */
export function ReadinessIcon({ done }: ReadinessIconProps) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={done ? "M5 12l5 5L20 7" : "M6 12h12"}
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
