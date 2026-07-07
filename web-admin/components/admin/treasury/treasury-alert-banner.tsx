"use client"

import { TreasuryAlertAcknowledge } from "@/components/admin/treasury-alert-acknowledge"
import type { TreasuryAlertBannerProps } from "@/types/components"

/**
 * The threshold-breach warning banner — surfaced from the highest-severity
 * unacknowledged alert. "Acknowledge" is the shared step-up-gated `TreasuryAlertAcknowledge`
 * (reason → step-up); nothing here moves money (§3.1).
 */
export function TreasuryAlertBanner({ alert }: TreasuryAlertBannerProps) {
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2.5 rounded-xl border border-[#f0e2c4] bg-swn px-4 py-3"
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="shrink-0 text-twn"
      >
        <path
          d="M12 4l9 16H3zM12 10v4M12 17h.01"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="flex-1 text-[12.5px] font-semibold text-twn">
        Exposure alert · {alert.message}
      </span>
      <TreasuryAlertAcknowledge alert={alert} />
    </div>
  )
}
