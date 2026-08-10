"use client"

import { cn } from "@/lib/utils"
import { AvatarPlaceholder, BrandMark } from "@/components/shared"
import { useCapabilities } from "@/lib/query/capabilities"
import { useMe, useProfile } from "@/lib/query/auth"
import { useAuthStore } from "@/lib/store/auth-store"
import type { DashboardSidebarProps } from "@/types"
import type { DashboardPage } from "@/lib/schemas"

// ─── Nav items definition ─────────────────────────────────────────────────────

const NAV_ITEMS: { page: DashboardPage; label: string }[] = [
  { page: "overview", label: "Overview" },
  { page: "wallet", label: "Wallet" },
  { page: "activity", label: "Activity" },
  { page: "tickets", label: "Tickets" },
  { page: "settings", label: "Settings" },
]

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Desktop dashboard sidebar.
 * Port of prototype lines 549–571.
 * Gradient: from-primary to-primary-deep (no hex).
 */
/**
 * Derive a display name from the MeResponse.
 * Priority: firstName + lastName → email → null (no label yet).
 */
function resolveDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | undefined
): string | null {
  const full = [firstName, lastName].filter(Boolean).join(" ").trim()
  if (full) return full
  // Fall back to the email's local-part (before @) when no name is set.
  if (email) return email.split("@")[0] ?? email
  return null
}

export function DashboardSidebar({
  active,
  onNavigate,
  className,
}: DashboardSidebarProps) {
  // Tickets is hidden until the ticketing capability is enabled in /config.
  const { canTickets } = useCapabilities()
  const items = NAV_ITEMS.filter((i) => i.page !== "tickets" || canTickets)

  // Prefer the fresh /auth/me query; fall back to the store's in-memory user
  // (populated at login time) while the query is loading.
  const { data: meData } = useMe()
  const storeUser = useAuthStore((s) => s.user)
  const user = meData ?? storeUser
  const displayName = resolveDisplayName(
    user?.firstName,
    user?.lastName,
    user?.email
  )

  // Real KYC tier for the verified badge — never hardcode it (it varies per
  // user; the engine gates limits on the actual tier). "tier_1" → "Tier 1".
  const profile = useProfile()
  const kycTier = profile.data?.kycTier
  const tierLabel = kycTier ? kycTier.replace(/^tier_/, "Tier ") : null

  return (
    <aside
      className={cn(
        "flex w-[236px] flex-none flex-col bg-gradient-to-b from-primary to-primary-deep p-4 text-primary-foreground",
        className
      )}
    >
      {/* ── Brand lockup ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-[11px] px-2 pb-1">
        {/* Logo mark */}
        <BrandMark size={34} />
        <span className="text-[15.5px] font-bold">Handshake Agent</span>
      </div>

      {/* ── Nav items ────────────────────────────────────────────────────── */}
      <nav
        className="mt-7 flex flex-col gap-[3px]"
        aria-label="Dashboard navigation"
      >
        {items.map(({ page, label }) => {
          const isActive = page === active
          return (
            <button
              key={page}
              type="button"
              data-active={isActive ? "true" : "false"}
              onClick={() => onNavigate(page)}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-[11px] px-3 py-[11px] text-left text-sm font-semibold transition-colors",
                isActive
                  ? "bg-accent/20 text-accent"
                  : "text-primary-foreground/80 hover:bg-white/5"
              )}
            >
              {/* Dot indicator */}
              <span
                className={cn(
                  "h-2 w-2 flex-none rounded-full",
                  isActive ? "bg-accent" : "bg-primary-foreground/30"
                )}
              />
              {label}
            </button>
          )
        })}
      </nav>

      {/* ── Spacer ───────────────────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── Verified account badge ───────────────────────────────────────── */}
      <div className="rounded-[14px] border border-white/10 bg-white/[0.06] p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-success-bright">
          {/* Lock SVG — uses currentColor-equivalent via stroke prop */}
          <svg
            width="12"
            height="13"
            viewBox="0 0 12 13"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 6V4.2a3 3 0 016 0V6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <rect
              x="1.6"
              y="6"
              width="8.8"
              height="6.2"
              rx="1.8"
              fill="currentColor"
            />
          </svg>
          Verified account
        </div>
        <p className="text-[12.5px] leading-snug text-primary-foreground/65">
          Identity confirmed{tierLabel ? ` · ${tierLabel} limits` : ""}
        </p>
      </div>

      {/* ── Profile ──────────────────────────────────────────────────────── */}
      <div className="mt-0 flex items-center gap-[11px] px-1.5 pt-[14px]">
        {/* Avatar — tokenized striped placeholder */}
        <AvatarPlaceholder size={38} />
        <div className="min-w-0 flex-1">
          {displayName && (
            <p className="text-[13.5px] font-bold">{displayName}</p>
          )}
          <p
            className={cn(
              "text-xs",
              displayName
                ? "text-primary-foreground/60"
                : "text-[13.5px] font-bold text-primary-foreground/80"
            )}
          >
            {displayName ? user?.email : (user?.email ?? "Account")}
          </p>
        </div>
      </div>
    </aside>
  )
}
