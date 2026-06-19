"use client"

import type { SuccessOverlayProps } from "@/types/components"

/**
 * SuccessOverlay — full-cover scrim with an animated success circle and text.
 *
 * Port of prototype lines 527–537 (mobile) / 970–975 (desktop).
 * Animations: `hsPop` (circle entrance) and `hsRing` (pulsing ring) — both
 * defined in `app/globals.css` under `@theme inline` and referenced via
 * `animate-hs-pop` / `animate-hs-ring`.
 *
 * No hex in components — token classes only (`bg-success`, `text-success-bright`).
 */
export function SuccessOverlay({ open, text }: SuccessOverlayProps) {
  if (!open) return null

  return (
    <div
      data-testid="success"
      className="absolute inset-0 z-[60] flex animate-hs-scrim flex-col items-center justify-center bg-foreground/55"
      style={{ backdropFilter: "blur(2px)" }}
    >
      {/* Check circle with pulsing ring */}
      <div className="relative">
        {/* Ring — expands and fades outward */}
        <div
          className="absolute inset-0 animate-hs-ring rounded-full border-2 border-success-bright"
          aria-hidden="true"
        />
        {/* Circle */}
        <div
          className="flex h-[84px] w-[84px] animate-hs-pop items-center justify-center rounded-full bg-success shadow-success"
          aria-hidden="true"
        >
          {/* Check mark SVG */}
          <svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M11 20.5l6 6.2L29 13"
              stroke="white"
              strokeWidth="3.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {/* Success text */}
      <p className="mt-5 text-[17px] font-bold text-card">{text}</p>
    </div>
  )
}
