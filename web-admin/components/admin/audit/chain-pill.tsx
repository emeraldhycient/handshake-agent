"use client"

import type { ChainPillProps } from "@/types"

/**
 * The header hash-chain pill — reflects the on-mount verify result: a neutral
 * "Verifying…" while pending, the green "Hash-chain verified" on `ok`, and a red
 * "Chain broken" pill (with the break point in the title) otherwise.
 */
export function ChainPill({ verify }: ChainPillProps) {
  if (verify.isPending || verify.isIdle) {
    return (
      <span className="flex h-[34px] items-center gap-[7px] rounded-full bg-card2 px-3 text-[11.5px] font-bold text-ink3">
        Verifying chain…
      </span>
    )
  }

  if (verify.isError || (verify.data && !verify.data.ok)) {
    const brokenAt = verify.data?.brokenAt
    return (
      <span
        className="flex h-[34px] items-center gap-[7px] rounded-full bg-sdn px-3 text-[11.5px] font-bold text-tdn"
        title={brokenAt ? `Broken at ${brokenAt}` : undefined}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M12 8v5m0 3v.5"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
        Chain broken
      </span>
    )
  }

  return (
    <span className="flex h-[34px] items-center gap-[7px] rounded-full bg-sok px-3 text-[11.5px] font-bold text-tok">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path
          d="m9 12 2 2 4-4"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Hash-chain verified
    </span>
  )
}
