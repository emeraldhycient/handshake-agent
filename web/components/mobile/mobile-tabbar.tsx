"use client"

import { cn } from "@/lib/utils"
import type { MobileTabbarProps, MobileTabId } from "@/types/components"

const TABS: {
  id: MobileTabId
  label: string
  Icon: () => React.JSX.Element
}[] = [
  {
    id: "chat",
    label: "Chat",
    Icon: () => (
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3 6.5A3.5 3.5 0 016.5 3h9A3.5 3.5 0 0119 6.5v5A3.5 3.5 0 0115.5 15H9l-4 3.5V15a3.5 3.5 0 01-2-3.2v-5.3z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "wallet",
    label: "Wallet",
    Icon: () => (
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill="none"
        aria-hidden="true"
      >
        <rect
          x="2.5"
          y="5"
          width="17"
          height="13"
          rx="3.2"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="M14.5 11.5h3.5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path d="M2.5 8.5h13" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    ),
  },
  {
    id: "activity",
    label: "Activity",
    Icon: () => (
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M2.5 12h3.5l2-7 3.5 13 2.2-8 1.3 2h4.5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
]

export function MobileTabbar({
  active,
  onSelect,
  className,
}: MobileTabbarProps) {
  return (
    <nav
      aria-label="Main navigation"
      className={cn(
        "flex flex-none border-t border-border bg-card",
        "px-2 pt-[9px] pb-[26px]",
        className
      )}
    >
      {TABS.map(({ id, label, Icon }) => {
        const isActive = active === id
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onSelect(id)}
            className={cn(
              "flex flex-1 cursor-pointer flex-col items-center gap-1",
              "border-none bg-transparent py-1 font-[inherit]",
              isActive ? "text-foreground" : "text-muted-foreground"
            )}
          >
            <Icon />
            <span className="text-[11px] font-semibold">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
