"use client"

/**
 * AppShell — the authenticated operator-console chrome (design spec §4):
 * a fixed dark-green sidebar rail + a 60px top bar + an independently
 * scrolling main column. Rebuilt 1:1 against `docs/design-ref/chrome.html`.
 *
 * Nav (§4.1): the design's full grouped nav — Overview / Customers / Compliance
 * / Money / Configuration / Channels / Commerce / Agent / Platform. A nav ITEM
 * renders only when its `menu_item` resourceId is in `adminMe.menus` (UX only;
 * the API still enforces every route). Dashboard + Admin settings are always
 * shown. A GROUP renders only when it has at least one visible item.
 *
 * Menu map (existing `menu.*` resourceIds, reused verbatim):
 *   Dashboard/Admin-settings → always · Users → menu.users ·
 *   KYC/Sanctions/AML/Blocked → menu.kyc | menu.compliance ·
 *   Transactions/Reconciliation → menu.transactions · Ledger → menu.ledger ·
 *   Treasury → menu.treasury ·
 *   Settings/Pricing/Limits/Capabilities/Assets/Currencies/Providers/Flags →
 *     menu.config · Templates/Notifications → menu.notifications ·
 *   WhatsApp → menu.whatsapp · Ticketing → menu.tickets · Agent → menu.agent ·
 *   Admins/Approvals → menu.access · Audit/Ops → menu.audit.
 *
 * Chrome behaviours:
 * - Sidebar collapse (232px ⇄ 70px) is local UI state.
 * - The theme toggle drives the Zustand theme store (mirrored to the DOM by
 *   `components/theme-provider.tsx`).
 * - The ⌘K search pill opens a CommandPalette over the shell's own nav; the
 *   bell opens a NotificationsMenu; the account pill opens an AccountMenu that
 *   shows the operator's real email + role (honest read-only, no impersonation).
 * - The KYC-review nav badge is wired to the live queue count; the other design
 *   badges (stuck txns / recon breaks / approvals) have no count endpoint yet.
 *
 * Pure presentation + the menu list derived from useAdminMe(); no data writes.
 */
import { useRequireAuth } from "@/lib/hooks/use-require-auth"
import { useAppShell } from "@/lib/hooks/use-app-shell"
import { SidebarRail } from "@/components/admin/app-shell/sidebar-rail"
import { TopBar } from "@/components/admin/app-shell/top-bar"
import { CommandPalette } from "@/components/admin/command-palette"
import { MfaEnrollDialog } from "@/components/admin/mfa-enroll-dialog"
import { RouteGuard } from "@/components/admin/route-guard"
import { Toaster } from "@/components/shared/toaster"
import type { AppShellProps } from "@/types"

/**
 * The centralized admin guard: authentication runs here (before ANY chrome or data
 * hooks mount), so an unauthenticated visitor is redirected to /login and never
 * fires an admin API call. Once authenticated, AppShellInner renders the chrome and
 * gates the page body by route permission via RouteGuard. Every authenticated screen
 * renders through here, so both checks run on every page load.
 */
export function AppShell({ children }: AppShellProps) {
  const authPhase = useRequireAuth()
  if (authPhase !== "authenticated") return null
  return <AppShellInner>{children}</AppShellInner>
}

function AppShellInner({ children }: AppShellProps) {
  const shell = useAppShell()

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-ink">
      <SidebarRail
        collapsed={shell.collapsed}
        onToggleCollapse={shell.toggleCollapsed}
        loading={shell.me.isLoading}
        error={shell.me.isError}
        groups={shell.visibleGroups}
        pathname={shell.pathname}
        badges={shell.badges}
        showMfaSetup={shell.showMfaSetup}
        onOpenMfa={() => shell.setMfaOpen(true)}
        onSignOut={shell.signOut}
      />

      {/* ── Main column — scrolls independently of the sidebar (§4) ────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          onOpenCmdk={() => shell.setCmdkOpen(true)}
          theme={shell.theme}
          onToggleTheme={shell.toggleTheme}
          email={shell.me.data?.email ?? ""}
          roleLabel={shell.me.data?.role.name ?? ""}
          onSignOut={shell.signOut}
        />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <RouteGuard>{children}</RouteGuard>
        </main>
      </div>

      {/* ⌘K command palette — opened by the search pill or the global shortcut. */}
      <CommandPalette
        open={shell.cmdkOpen}
        onOpenChange={shell.setCmdkOpen}
        destinations={shell.destinations}
      />

      <MfaEnrollDialog open={shell.mfaOpen} onOpenChange={shell.setMfaOpen} />

      {/* Global toast stack — read-shaped action confirmations (§5, design toast). */}
      <Toaster />
    </div>
  )
}
