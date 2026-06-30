"use client"

import { cn } from "@/lib/utils"
import { BrandMark } from "@/components/shared"
import type { ChatHeaderProps } from "@/types/components"

export function ChatHeader({ className }: ChatHeaderProps) {
  return (
    <div
      className={cn(
        "flex-none [background:linear-gradient(162deg,var(--primary)_0%,var(--primary-deep)_100%)]",
        "relative z-10 px-[18px] pt-[54px] pb-4 text-primary-foreground",
        className
      )}
    >
      <div className="flex items-center gap-3">
        {/* Brand avatar with online indicator — the animated spark mark
            (honors prefers-reduced-motion: renders static when motion is off). */}
        <div className="relative h-[42px] w-[42px] flex-none">
          <BrandMark size={42} variant="spark" className="shadow-lg" />
          <div
            className={cn(
              "absolute -right-0.5 -bottom-0.5",
              "h-[13px] w-[13px] rounded-full bg-success-bright",
              "border-[2.5px] border-primary-deep"
            )}
            aria-hidden="true"
          />
        </div>

        {/* Name + status */}
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-bold tracking-[-0.01em] text-primary-foreground">
            Handshake Agent
          </div>
          <div className="mt-[1px] text-[12.5px] text-primary-foreground/70">
            Online · replies instantly
          </div>
        </div>

        {/* Secured badge */}
        <div
          className={cn(
            "flex items-center gap-1.5",
            "rounded-full border border-white/15 bg-white/10",
            "px-[11px] py-[5px] pl-[9px]"
          )}
        >
          <svg
            width="12"
            height="13"
            viewBox="0 0 12 13"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <path
              d="M3 6V4.2a3 3 0 016 0V6"
              className="stroke-success-bright"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <rect
              x="1.6"
              y="6"
              width="8.8"
              height="6.2"
              rx="1.8"
              className="fill-success-bright"
            />
          </svg>
          <span className="text-[11.5px] font-semibold text-success-bright">
            Secured
          </span>
        </div>
      </div>
    </div>
  )
}
