import type { ReactNode } from "react"
import type { Density } from "./components"

export interface ChatCardShellProps {
  density: Density
  /**
   * Apply the raised desktop shadow (the 5 "heavy" cards: quote, swap, settling,
   * pay-in, needs-beneficiary). Mobile always carries `shadow-card`.
   */
  desktopShadow?: boolean
  className?: string
  children: ReactNode
}

export interface QuoteExpiryPillProps {
  remaining: number
  isExpired: boolean
  density: Density
}

export interface ExpiringCardCtaProps {
  isExpired: boolean
  onConfirm: () => void
  activeLabel: string
  expiredLabel: string
  activeHint: string
  expiredHint: string
  density: Density
}
