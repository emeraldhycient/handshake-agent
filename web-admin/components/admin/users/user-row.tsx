"use client"

import { cn } from "@/lib/utils"
import { FLAG_META, GRID_COLS, KYC_META } from "@/constants/users"
import type { UserRowProps } from "@/types"

/** One Users-directory row — keyboard-navigable, opens `/users/[id]`. */
export function UserRow({
  user,
  selected,
  onToggleSelect,
  onOpen,
}: UserRowProps) {
  const km = KYC_META[user.kyc]

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(user.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen(user.id)
        }
      }}
      aria-label={`Open ${user.name}`}
      className={cn(
        GRID_COLS,
        "min-h-[52px] cursor-pointer border-b border-line2 px-[18px] transition-colors last:border-b-0 hover:bg-hov focus-visible:bg-hov focus-visible:outline-none"
      )}
    >
      {/* Checkbox */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelect(user.id)
        }}
        aria-label={selected ? `Deselect ${user.name}` : `Select ${user.name}`}
        aria-pressed={selected}
        className="justify-self-start focus-visible:outline-none"
      >
        <span
          aria-hidden
          className={cn(
            "inline-block size-4 rounded-[5px] border-[1.5px]",
            selected ? "border-brand-green bg-brand-green" : "border-line"
          )}
        />
      </button>

      {/* Customer */}
      <div className="flex min-w-0 items-center gap-[11px]">
        <span
          aria-hidden
          className="flex size-8 flex-none items-center justify-center rounded-full text-[12px] font-extrabold text-white"
          style={{ background: user.avatar }}
        >
          {user.initials}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-ink">
            {user.name}
          </div>
          <div className="truncate text-[11px] text-ink3">{user.email}</div>
        </div>
      </div>

      {/* KYC */}
      <div>
        <span
          className={cn(
            "inline-flex items-center gap-[5px] rounded-full px-[9px] py-[3px] text-[11px] font-bold",
            km.bg,
            km.fg
          )}
        >
          {km.label}
        </span>
        <div className="mt-0.5 text-[10px] text-ink3">{user.tier}</div>
      </div>

      {/* Country — not in the list contract (shape gap) */}
      <div className="text-[12px] font-semibold text-ink3">—</div>

      {/* Balance — per-asset aggregate of cached wallet balances */}
      <div
        className={cn(
          "text-right text-[12.5px] font-bold tabular-nums",
          user.balance === "—" ? "text-ink3" : "text-ink"
        )}
      >
        {user.balance}
      </div>

      {/* Risk — simSwap + sanctions are modeled on the list item */}
      <div className="flex flex-wrap gap-[4px]">
        {user.simSwapFlagged && (
          <span
            title={FLAG_META.simSwap.full}
            className={cn(
              "rounded-[5px] px-[6px] py-[2px] text-[9.5px] font-extrabold tracking-[0.03em]",
              FLAG_META.simSwap.bg,
              FLAG_META.simSwap.fg
            )}
          >
            {FLAG_META.simSwap.label}
          </span>
        )}
        {user.sanctionsFlagged && (
          <span
            title={FLAG_META.sanctions.full}
            className={cn(
              "rounded-[5px] px-[6px] py-[2px] text-[9.5px] font-extrabold tracking-[0.03em]",
              FLAG_META.sanctions.bg,
              FLAG_META.sanctions.fg
            )}
          >
            {FLAG_META.sanctions.label}
          </span>
        )}
      </div>

      {/* Last active — real latest session/device/transaction activity */}
      <div className="text-[11.5px] text-ink2 tabular-nums">
        {user.lastActive}
      </div>
    </div>
  )
}
