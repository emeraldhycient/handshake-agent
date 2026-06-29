"use client"

import { AssetIcon } from "@/components/shared/asset-icon"
import { Money } from "@/components/shared/money"
import { StatusPill } from "@/components/shared/status-pill"
import { Skeleton } from "@/components/ui/skeleton"
import { useBalances, useWalletAssets, useActivity } from "@/lib/query/hooks"
import { useCapabilities } from "@/lib/query/capabilities"
import { cn } from "@/lib/utils"
import type { ChatAction } from "@/lib/schemas"
import type { PageWithQuickActionProps } from "@/types/components"

// ─── Hero action definitions ──────────────────────────────────────────────────

const HERO_ACTIONS: { action: ChatAction; label: string; primary: boolean }[] =
  [
    { action: "buy", label: "Buy", primary: true },
    { action: "send", label: "Send", primary: false },
    { action: "receive", label: "Receive", primary: false },
    { action: "swap", label: "Swap", primary: false },
  ]

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Desktop overview page.
 * Port of prototype lines 620–681.
 * Gradient: from-primary to-primary-deep (no hex).
 * Four async branches: loading / error / empty / data.
 */
export function OverviewPage({
  onQuickAction,
  className,
}: PageWithQuickActionProps) {
  const balances = useBalances()
  const assets = useWalletAssets()
  const activity = useActivity()
  const { canSwap } = useCapabilities()
  // Swap is hidden until the crypto.swap capability is enabled in /config.
  const heroActions = canSwap
    ? HERO_ACTIONS
    : HERO_ACTIONS.filter((a) => a.action !== "swap")

  const isLoading = balances.isLoading || assets.isLoading || activity.isLoading
  const isError = balances.isError || assets.isError || activity.isError

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col gap-[18px] overflow-y-auto p-6",
          className
        )}
      >
        {/* Balance hero skeleton */}
        <Skeleton className="h-[120px] rounded-[18px]" />
        {/* Asset table skeleton */}
        <Skeleton className="h-[180px] rounded-[18px]" />
        {/* Activity skeleton */}
        <Skeleton className="h-[160px] rounded-[18px]" />
      </div>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div
        className={cn("flex flex-1 items-center justify-center p-6", className)}
      >
        <div className="border-danger/20 bg-danger/5 rounded-[14px] border p-5 text-center">
          <p className="text-danger text-sm font-semibold">
            Failed to load overview
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      </div>
    )
  }

  const balanceData = balances.data
  const assetData = assets.data ?? []
  const activityData = activity.data ?? []

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!balanceData && assetData.length === 0 && activityData.length === 0) {
    return (
      <div
        className={cn("flex flex-1 items-center justify-center p-6", className)}
      >
        <p className="text-sm text-muted-foreground">No data yet.</p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-[18px] overflow-y-auto p-6",
        className
      )}
    >
      {/* ── Balance hero ────────────────────────────────────────────────────── */}
      <div className="flex items-end gap-8 rounded-[18px] bg-gradient-to-b from-primary to-primary-deep px-[26px] py-6 text-primary-foreground">
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-primary-foreground/70">
            Total balance
          </p>
          <Money
            value={balanceData?.total ?? "—"}
            as="div"
            className="mt-0.5 text-[40px] font-extrabold tracking-tight tabular-nums"
          />
        </div>
        {/* Action buttons */}
        <div className="flex gap-[10px]">
          {heroActions.map(({ action, label, primary }) => (
            <button
              key={action}
              type="button"
              aria-label={label}
              onClick={() => onQuickAction(action, label)}
              className={cn(
                "cursor-pointer rounded-[12px] px-5 py-[11px] text-sm font-bold transition-opacity hover:opacity-90",
                primary
                  ? "bg-accent text-accent-foreground"
                  : "border border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Assets table ────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[18px] border border-border bg-card">
        {/* Table header */}
        <div className="flex items-center border-b border-border px-[22px] py-3.5 text-xs font-bold tracking-widest text-muted-foreground uppercase">
          <div className="flex-[2]">Asset</div>
          <div className="flex-[1.4] text-right">Holdings</div>
          <div className="flex-[1.4] text-right">Price</div>
          <div className="flex-[1] text-right">24h</div>
          <div className="flex-[1.4] text-right">Value</div>
        </div>
        {/* Table rows */}
        {assetData.map((a, idx) => (
          <div
            key={a.sym + a.name}
            className={cn(
              "flex items-center px-[22px] py-[15px]",
              idx < assetData.length - 1 && "border-b border-border"
            )}
          >
            <div className="flex flex-[2] items-center gap-3">
              <AssetIcon sym={a.sym} tint={a.tint} size="sm" />
              <div>
                <p className="text-[14.5px] font-bold text-foreground">
                  {a.name}
                </p>
                <p className="text-xs text-muted-foreground">{a.sub}</p>
              </div>
            </div>
            <Money
              value={a.amount.split(" ")[0]}
              className="flex-[1.4] text-right text-sm text-foreground"
            />
            <div className="flex-[1.4] text-right text-sm text-foreground tabular-nums">
              —
            </div>
            <p
              className={cn(
                "flex-[1] text-right text-[13.5px] tabular-nums",
                a.change.startsWith("+")
                  ? "text-success"
                  : "text-muted-foreground"
              )}
            >
              {a.change}
            </p>
            <Money
              value={a.value}
              className="flex-[1.4] text-right text-[14.5px] font-bold text-foreground"
            />
          </div>
        ))}
      </div>

      {/* ── Recent activity ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-[18px] border border-border bg-card">
        <p className="border-b border-border px-[22px] pt-[15px] pb-[11px] text-xs font-bold tracking-widest text-muted-foreground uppercase">
          Recent activity
        </p>
        {activityData.flatMap((g) => g.items).length === 0 && (
          <p className="flex-1 px-[22px] py-4 text-sm text-muted-foreground">
            No recent activity.
          </p>
        )}
        {activityData.flatMap((g) =>
          g.items.map((item, idx, arr) => (
            <div
              key={item.id}
              className={cn(
                "flex items-center gap-[13px] px-[22px] py-[13px]",
                idx < arr.length - 1 && "border-b border-border"
              )}
            >
              {/* Icon */}
              <div
                className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] text-base font-bold"
                style={{ backgroundColor: item.tint, color: item.col }}
              >
                {item.icon}
              </div>
              {/* Body */}
              <div className="flex-1">
                <p className="text-sm font-bold text-foreground">
                  {item.title}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {item.sub}
                </p>
              </div>
              {/* Amount + status */}
              <div className="text-right">
                <Money
                  value={item.amount}
                  as="p"
                  className="text-sm font-bold text-foreground"
                />
                <StatusPill
                  tone={item.statusTone}
                  className="mt-0.5 text-[11px]"
                >
                  {item.status}
                </StatusPill>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
