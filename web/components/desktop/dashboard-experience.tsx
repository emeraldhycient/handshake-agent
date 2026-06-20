"use client"

import { useState } from "react"
import { DashboardSidebar } from "@/components/desktop/dashboard-sidebar"
import { DashboardTopbar } from "@/components/desktop/dashboard-topbar"
import { ChatRail } from "@/components/desktop/chat-rail"
import { OverviewPage } from "@/components/desktop/overview-page"
import { WalletPage } from "@/components/desktop/wallet-page"
import { ActivityPage } from "@/components/desktop/activity-page"
import { TicketsPage } from "@/components/desktop/tickets-page"
import { SettingsPage } from "@/components/desktop/settings-page"
import { defaultChatStore } from "@/lib/store/chat-store"
import { chipLabel } from "@/lib/chat/flow"
import type { DashboardPage } from "@/lib/schemas"
import type { ChatAction, SearchResult } from "@/lib/schemas"

/**
 * Full-width desktop layout — extracted from the /dashboard route so it can
 * be embedded in AdaptiveExperience without duplication.
 *
 * Layout: [Sidebar 236px] | [Main column: Topbar + Page] | [ChatRail 372px]
 *
 * Store: `defaultChatStore` is the module singleton shared between this
 * component and the ChatRail. Quick-actions and search selections write to
 * surface "d" — the rail reads from the same store instance so messages
 * appear immediately.
 */
export function DashboardExperience() {
  const [dPage, setDPage] = useState<DashboardPage>("overview")

  // ── Quick action handler ──────────────────────────────────────────────────
  function handleQuickAction(action: ChatAction, label: string) {
    defaultChatStore.getState().send("d", label, action)
  }

  // ── Search select handler ─────────────────────────────────────────────────
  function handleSearchSelect(result: SearchResult) {
    if (result.page) {
      setDPage(result.page)
    }
    if (result.action) {
      const label = result.label ?? chipLabel(result.action)
      defaultChatStore.getState().send("d", label, result.action)
    }
  }

  // ── Active page render ────────────────────────────────────────────────────
  function renderPage() {
    switch (dPage) {
      case "overview":
        return <OverviewPage onQuickAction={handleQuickAction} />
      case "wallet":
        return <WalletPage onQuickAction={handleQuickAction} />
      case "activity":
        return <ActivityPage />
      case "tickets":
        return <TicketsPage onQuickAction={handleQuickAction} />
      case "settings":
        return <SettingsPage />
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* ── Sidebar (hidden below lg) ──────────────────────────────────────── */}
      <DashboardSidebar
        active={dPage}
        onNavigate={setDPage}
        className="hidden lg:flex"
      />

      {/* ── Main column ───────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <DashboardTopbar
          onSearchSelect={handleSearchSelect}
          onQuickAction={handleQuickAction}
        />

        {/* Active page — fills remaining height */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {renderPage()}
        </div>
      </div>

      {/* ── Chat rail (hidden below lg) ────────────────────────────────────── */}
      <ChatRail store={defaultChatStore} className="hidden lg:flex" />
    </div>
  )
}
