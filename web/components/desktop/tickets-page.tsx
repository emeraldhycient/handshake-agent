"use client"

import { QrPlaceholder } from "@/components/shared/qr-placeholder"
import { Skeleton } from "@/components/ui/skeleton"
import { useEvents } from "@/lib/query/hooks"
import { cn } from "@/lib/utils"
import type { PageWithQuickActionProps } from "@/types/components"

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Desktop tickets page.
 * Port of prototype lines 747–778.
 * Static confirmed ticket card + useEvents browse list.
 * Four async branches on the events list (loading / error / empty / data).
 */
export function TicketsPage({
  onQuickAction,
  className,
}: PageWithQuickActionProps) {
  const events = useEvents()

  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-4 overflow-y-auto p-6",
        className
      )}
    >
      {/* ── Page headline ───────────────────────────────────────────────────── */}
      <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
        Your tickets
      </h1>

      {/* ── Static confirmed ticket card ─────────────────────────────────────── */}
      <div className="flex overflow-hidden rounded-[18px] border border-border bg-card">
        {/* Left banner */}
        <div className="relative flex w-[150px] flex-none items-center justify-center bg-gradient-to-br from-primary to-primary-deep">
          {/* Diagonal stripe overlay — uses color-mix to avoid rgba literals */}
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(115deg, color-mix(in oklch, var(--accent) 16%, transparent) 0 12px, transparent 12px 26px)",
            }}
          />
          {/* Mini QR */}
          <div className="relative">
            <QrPlaceholder size={78} />
          </div>
        </div>

        {/* Right content */}
        <div className="flex-1 px-5 py-[18px]">
          <p className="text-xs font-bold tracking-widest text-success uppercase">
            Confirmed
          </p>
          <h2 className="mt-0.5 text-[19px] font-extrabold text-foreground">
            Afrobeats Live 2026
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Sat 12 Jul, 8:00pm · Eko Hotel, Lagos
          </p>
          <div className="mt-[14px] flex gap-6">
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">
                Tier
              </p>
              <p className="text-[14px] font-bold text-foreground">Regular</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">
                Entry code
              </p>
              <p className="font-mono text-[14px] font-bold text-foreground">
                AFL-26-7741
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">
                Gate
              </p>
              <p className="text-[14px] font-bold text-foreground">Gate B</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Browse events section ────────────────────────────────────────────── */}
      <h2 className="mt-1 text-[20px] font-extrabold tracking-tight text-foreground">
        Browse events
      </h2>

      {/* Loading state */}
      {events.isLoading && (
        <div className="overflow-hidden rounded-[16px] border border-border bg-card">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center gap-[14px] border-t border-border px-[18px] py-[15px] first:border-t-0"
            >
              <Skeleton className="h-11 w-11 flex-none rounded-[11px]" />
              <div className="flex-1">
                <Skeleton className="mb-1.5 h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-24 rounded-[11px]" />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {events.isError && (
        <div className="border-danger/20 bg-danger/5 rounded-[14px] border p-5 text-center">
          <p className="text-danger text-sm font-semibold">
            Failed to load events
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {/* Empty state */}
      {!events.isLoading &&
        !events.isError &&
        (events.data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">No events available.</p>
        )}

      {/* Data state */}
      {!events.isLoading &&
        !events.isError &&
        (events.data ?? []).length > 0 && (
          <div className="overflow-hidden rounded-[16px] border border-border bg-card">
            {(events.data ?? []).map((e, idx) => (
              <div
                key={e.name}
                className={cn(
                  "flex items-center gap-[14px] px-[18px] py-[15px]",
                  idx > 0 && "border-t border-border"
                )}
              >
                {/* Event thumbnail — gradient placeholder */}
                <div className="h-11 w-11 flex-none rounded-[11px] bg-gradient-to-br from-primary to-primary-deep" />
                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-bold text-foreground">
                    {e.name}
                  </p>
                  <p className="text-[12.5px] text-muted-foreground">
                    {e.meta}
                  </p>
                </div>
                {/* Price */}
                <p className="text-[13px] text-muted-foreground tabular-nums">
                  {e.price}
                </p>
                {/* CTA */}
                <button
                  type="button"
                  aria-label="Get ticket"
                  onClick={() =>
                    onQuickAction("ticket", `Get me a ticket to ${e.name}`)
                  }
                  className="flex-none cursor-pointer rounded-[11px] bg-accent px-4 py-[9px] text-[13px] font-bold text-accent-foreground hover:opacity-90"
                >
                  Get ticket
                </button>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}
