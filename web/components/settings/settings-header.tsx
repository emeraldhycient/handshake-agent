"use client"

import { cn } from "@/lib/utils"
import type { SettingsHeaderProps } from "@/types"

const AMBER_CHIP =
  "[background:linear-gradient(150deg,var(--color-accent),var(--color-accent-deep))]"

/**
 * Settings chrome: the desktop page header (brand chip + title + "Ask the
 * agent") and the mobile app-bar (back + title + "Ask"). The mobile bar is
 * flex-none so it stays pinned above the scrolling body.
 */
export function SettingsHeader({
  density,
  onBack,
  onAsk,
}: SettingsHeaderProps) {
  if (density === "mobile") {
    return (
      <div className="flex flex-none items-center gap-3 border-b border-settings-chip-border bg-background px-[18px] pt-[calc(env(safe-area-inset-top,0px)+18px)] pb-[14px]">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] border border-settings-outline bg-card"
        >
          <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
            <path
              d="M11 4l-5 5 5 5"
              stroke="#3d4a42"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="flex-1 text-[19px] font-extrabold tracking-[-0.02em]">
          Settings
        </div>
        <AskButton density="mobile" onClick={onAsk} />
      </div>
    )
  }

  return (
    <div className="mb-9 flex items-end justify-between gap-6">
      <div>
        <div className="mb-2.5 flex items-center gap-[9px]">
          <div
            className={cn(
              "flex h-[22px] w-[22px] items-center justify-center rounded-[7px]",
              AMBER_CHIP
            )}
          >
            <div className="h-2 w-2 rounded-[3px] bg-primary-deep" />
          </div>
          <span className="mono text-[12px] font-medium tracking-[0.08em] text-settings-soft uppercase">
            Handshake · Account
          </span>
        </div>
        <h1 className="text-[34px] font-extrabold tracking-[-0.03em] text-foreground">
          Settings
        </h1>
      </div>
      <AskButton density="desktop" onClick={onAsk} />
    </div>
  )
}

function AskButton({
  density,
  onClick,
}: {
  density: "desktop" | "mobile"
  onClick?: () => void
}) {
  const mobile = density === "mobile"
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex flex-none items-center rounded-full border border-settings-outline bg-card font-bold text-settings-ink-strong",
        mobile
          ? "gap-[7px] py-[5px] pr-3 pl-[5px] text-[12.5px]"
          : "gap-[9px] py-[7px] pr-4 pl-2 text-[14px] shadow-[0_1px_2px_rgb(22_38_30/0.04)] hover:bg-card-muted"
      )}
    >
      <span
        className={cn(
          "flex flex-none items-center justify-center rounded-full text-primary-deep",
          AMBER_CHIP,
          mobile ? "h-[26px] w-[26px]" : "h-[30px] w-[30px]"
        )}
      >
        <svg
          width={mobile ? 13 : 15}
          height={mobile ? 13 : 15}
          viewBox="0 0 20 20"
          fill="none"
        >
          <path
            d="M10 2v16M2 10h16M4.5 4.5l11 11M15.5 4.5l-11 11"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {mobile ? "Ask" : "Ask the agent"}
    </button>
  )
}
