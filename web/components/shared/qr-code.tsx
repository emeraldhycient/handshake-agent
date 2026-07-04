import { QRCodeSVG } from "qrcode.react"
import { cn } from "@/lib/utils"
import { QR_COLORS } from "@/lib/site"
import type { QrCodeProps } from "@/types/components"

/**
 * Real, scannable QR code (client-rendered by qrcode.react — no network calls,
 * CSP-safe). The colours are functional data (high-contrast for scanners), not
 * theme tokens. Exposed as a single accessible `img` region; the inner SVG is
 * decorative.
 */
export function QrCode({ value, label, size = 180, className }: QrCodeProps) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "inline-flex rounded-xl border border-border bg-card p-3 shadow-card",
        className
      )}
    >
      <QRCodeSVG
        value={value}
        size={size}
        level="M"
        marginSize={2}
        fgColor={QR_COLORS.foreground}
        bgColor={QR_COLORS.background}
        aria-hidden="true"
      />
    </div>
  )
}
