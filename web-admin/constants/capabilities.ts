/**
 * Capabilities switchboard constants (design §6.25). The static per-capability
 * presentation metadata (the config contract carries only the boolean) + the icon-tile
 * tint map. `on` is never here — it comes from the live `catalog.capabilities.crypto.<x>`
 * setting value.
 */
import type { CapabilityPresentation, CapabilityTone } from "@/types/components"

export const PRESENTATION: readonly CapabilityPresentation[] = [
  {
    settingKey: "catalog.capabilities.crypto.buy",
    label: "crypto.buy",
    desc: "Buy USDT/TRX with NGN",
    provider: "Blockradar",
    tone: "success",
    // coin / currency mark
    icon: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  },
  {
    settingKey: "catalog.capabilities.crypto.sell",
    label: "crypto.sell",
    desc: "Sell crypto to NGN payout",
    provider: "Blockradar + Flutterwave",
    tone: "info",
    // bank / payout mark
    icon: "M4 10h16M4 10l8-6 8 6M6 10v8M10 10v8M14 10v8M18 10v8M4 20h16",
  },
  {
    settingKey: "catalog.capabilities.crypto.send",
    label: "send",
    desc: "On-chain transfer to beneficiary",
    provider: "Blockradar",
    tone: "warn",
    // paper-plane mark
    icon: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z",
  },
  {
    settingKey: "catalog.capabilities.crypto.swap",
    label: "swap",
    desc: "USDT ↔ TRX swap",
    provider: "Blockradar",
    tone: "info",
    // swap arrows mark
    icon: "M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  },
] as const

/** The icon tile tint → status-token surface/text utility pair (tokens only). */
export const TONE_TILE: Record<CapabilityTone, string> = {
  success: "bg-sok text-tok",
  info: "bg-sif text-tif",
  warn: "bg-swn text-twn",
  neutral: "bg-card2 text-ink2",
}
