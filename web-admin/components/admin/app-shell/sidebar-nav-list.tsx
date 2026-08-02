"use client"

/**
 * SidebarNavList — the RBAC-scoped `<nav>` inside the sidebar rail: the four async
 * branches (loading skeleton / error / empty / grant-visible groups) and each
 * group's items with their active state + count badge. Presentation only; the
 * grant-visible groups are derived upstream in `useAppShell`.
 */
import Link from "next/link"

import { cn } from "@/lib/utils"
import { isActive } from "@/lib/nav/admin-nav"
import type { SidebarNavListProps } from "@/types"

export function SidebarNavList({
  loading,
  error,
  collapsed,
  groups,
  pathname,
  badges,
}: SidebarNavListProps) {
  return (
    <nav
      aria-busy={loading}
      className="flex-1 overflow-y-auto px-[10px] pt-[6px] pb-[14px]"
    >
      {loading ? (
        <ul className="space-y-1.5 px-1 pt-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <li
              key={i}
              aria-hidden="true"
              className="h-9 animate-pulse rounded-[10px] bg-[color:rgba(255,255,255,0.06)]"
            />
          ))}
        </ul>
      ) : error ? (
        <p className="px-2 pt-3 text-[12px] font-medium text-[color:rgba(214,226,219,0.7)]">
          Couldn&apos;t load your navigation. Reload to try again.
        </p>
      ) : groups.length === 0 ? (
        <p className="px-2 pt-3 text-[12px] font-medium text-[color:rgba(214,226,219,0.7)]">
          No sections available for your role.
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.label} className="mb-[13px]">
            {!collapsed && (
              <div className="px-[10px] pt-[2px] pb-[6px] text-[10px] font-bold tracking-[0.09em] text-[color:rgba(214,226,219,0.42)] uppercase">
                {group.label}
              </div>
            )}
            <ul>
              {group.items.map((item) => {
                const active = isActive(pathname, item.href)
                const Icon = item.icon
                const badge = item.badge ? (badges[item.badge] ?? 0) : 0
                return (
                  <li key={item.href} className="mb-px">
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-[11px] rounded-[10px] px-[10px] py-2 transition-colors outline-none",
                        "focus-visible:ring-2 focus-visible:ring-[color:var(--brand-amber)]",
                        active
                          ? "bg-[color:rgba(245,166,35,0.16)] text-[color:var(--brand-amber)]"
                          : "text-sidebar-foreground hover:bg-[color:rgba(255,255,255,0.07)]"
                      )}
                    >
                      <Icon aria-hidden="true" className="size-[18px] flex-none" />
                      {!collapsed && (
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                          {item.label}
                        </span>
                      )}
                      {!collapsed && badge > 0 && (
                        <span className="flex-none rounded-full bg-[color:var(--brand-amber)] px-[7px] py-px text-center text-[10.5px] font-bold text-[color:var(--brand-green-deep)] tabular-nums">
                          {badge}
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))
      )}
    </nav>
  )
}
