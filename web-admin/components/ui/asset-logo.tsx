"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"
import type { AssetLogoProps } from "@/types"

/**
 * AssetLogo — a square asset badge that shows the provider-discovered logo image
 * (Blockradar Cloudinary) when a `logoUrl` is supplied and loads, and falls back to
 * the tinted `sym` text badge on a missing URL or an image load error.
 *
 * `className` carries the container styling (size, rounding, background, and the
 * fallback text classes, which the symbol inherits) so each call site keeps its own
 * design-faithful badge (green chip in the table, white chip in the discovered card).
 * The image is a plain `<img>` (not `next/image`): the logos are arbitrary remote
 * Cloudinary hosts that `remotePatterns` can't enumerate. Best-effort display only —
 * nothing here moves money (§3.1).
 */
export function AssetLogo({ sym, logoUrl, className }: AssetLogoProps) {
  const [failed, setFailed] = useState(false)
  const showLogo = Boolean(logoUrl) && !failed

  return (
    <span
      className={cn(
        "flex flex-none items-center justify-center overflow-hidden",
        className
      )}
    >
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote provider logos (arbitrary Cloudinary hosts); next/image remotePatterns can't enumerate them
        <img
          src={logoUrl!}
          alt={sym}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        sym
      )}
    </span>
  )
}
