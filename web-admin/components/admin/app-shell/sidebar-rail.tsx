"use client"

/**
 * SidebarRail — the fixed dark-green sidebar (§4.1): brand mark, the RBAC-scoped
 * {@link SidebarNavList}, and the footer (collapse toggle + optional MFA-setup +
 * sign out). Collapsing (232px ⇄ 70px) hides the labels and group headers.
 * Presentation only; all state lives in `useAppShell`.
 */
import { LogOut, PanelLeftClose, PanelLeftOpen, ShieldCheck } from "lucide-react"

import { cn } from "@/lib/utils"
import { RAIL_BG } from "@/constants/admin-nav"
import { SidebarNavList } from "@/components/admin/app-shell/sidebar-nav-list"
import type { SidebarRailProps } from "@/types"

export function SidebarRail({
  collapsed,
  onToggleCollapse,
  loading,
  error,
  groups,
  pathname,
  badges,
  showMfaSetup,
  onOpenMfa,
  onSignOut,
}: SidebarRailProps) {
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose

  return (
    <aside
      aria-label="Admin navigation"
      style={{ background: RAIL_BG }}
      className={cn(
        "z-20 flex flex-none flex-col text-sidebar-foreground transition-[width] duration-200 ease-out",
        collapsed ? "w-[70px]" : "w-[232px]"
      )}
    >
      {/* Brand */}
      <div className="flex flex-none items-center gap-[11px] px-[18px] pt-[18px] pb-[14px]">
        <div
          style={{
            background:
              "linear-gradient(150deg, var(--brand-amber), var(--brand-amber-deep))",
          }}
          className="flex size-[34px] flex-none items-center justify-center rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
        >
          <div className="size-[13px] rounded-[4px] bg-brand-green-deep" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-[14.5px] font-bold tracking-[-0.01em] whitespace-nowrap">
              Handshake Agent
            </div>
            <div className="text-[10.5px] font-semibold tracking-[0.06em] text-[color:rgba(214,226,219,0.55)] uppercase">
              Operator Console
            </div>
          </div>
        )}
      </div>

      <SidebarNavList
        loading={loading}
        error={error}
        collapsed={collapsed}
        groups={groups}
        pathname={pathname}
        badges={badges}
      />

      {/* Footer: collapse toggle + MFA setup + sign out (§4.1) */}
      <div className="flex-none border-t border-[color:rgba(255,255,255,0.08)] p-[10px]">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          className="flex w-full items-center gap-[10px] rounded-[10px] px-[10px] py-2 text-[color:rgba(214,226,219,0.7)] transition-colors outline-none hover:bg-[color:rgba(255,255,255,0.06)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-amber)]"
        >
          <CollapseIcon aria-hidden="true" className="size-[17px] flex-none" />
          {!collapsed && (
            <span className="text-[12.5px] font-semibold">Collapse</span>
          )}
        </button>

        {/* MFA enrollment — the operator's own security setup, reachable from every
            authenticated page. */}
        {showMfaSetup && (
          <button
            type="button"
            onClick={onOpenMfa}
            title={collapsed ? "Set up MFA" : undefined}
            className="mt-1 flex w-full items-center gap-[10px] rounded-[10px] px-[10px] py-2 text-[color:rgba(214,226,219,0.85)] transition-colors outline-none hover:bg-[color:rgba(255,255,255,0.06)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-amber)]"
          >
            <ShieldCheck aria-hidden="true" className="size-[17px] flex-none" />
            {!collapsed && (
              <span className="text-[12.5px] font-semibold">Set up MFA</span>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onSignOut}
          aria-label="Sign out"
          title={collapsed ? "Sign out" : undefined}
          className="mt-1 flex w-full items-center gap-[10px] rounded-[10px] px-[10px] py-2 text-[color:rgba(214,226,219,0.7)] transition-colors outline-none hover:bg-[color:rgba(255,255,255,0.06)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-amber)]"
        >
          <LogOut aria-hidden="true" className="size-[17px] flex-none" />
          {!collapsed && (
            <span className="text-[12.5px] font-semibold">Sign out</span>
          )}
        </button>
      </div>
    </aside>
  )
}
