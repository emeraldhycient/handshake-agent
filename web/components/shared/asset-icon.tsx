"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import type { AssetIconProps } from "@/types/components"

/**
 * Tinted chip showing an asset.
 * When a `logoUrl` is supplied (and loads) the real asset logo is shown; on a
 * missing URL or an image load error it falls back to the tinted text badge.
 * The `tint` prop is applied via inline style (the one approved data exception —
 * asset tints are dynamic data values, not theme colors; §3 of the plan).
 * No hex in className. Symbol text uses token class `text-foreground`.
 */
export function AssetIcon({
  sym,
  tint,
  logoUrl,
  size = "md",
  className,
}: AssetIconProps) {
  const [logoFailed, setLogoFailed] = useState(false)
  const showLogo = Boolean(logoUrl) && !logoFailed

  return (
    <div
      data-testid="asset-icon"
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-full text-sm font-bold text-foreground",
        size === "sm" ? "size-8" : "size-[38px]",
        className
      )}
      style={{ backgroundColor: tint }}
    >
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote provider logos (arbitrary Cloudinary hosts); next/image remotePatterns can't enumerate them
        <img
          src={logoUrl}
          alt={sym}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        sym
      )}
    </div>
  )
}
