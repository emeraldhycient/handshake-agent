import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { Panel } from "@/components/admin/user-detail/panel"
import { actionDot, actionLabel } from "@/lib/users/user-detail"
import { NOT_PROVIDED } from "@/constants/user-detail"
import type { UdProfileTabProps } from "@/types"

/**
 * The Profile tab — Contact & locale (design fields the contract does not provide
 * render "—") plus the admin-action timeline and immutable case notes, each with
 * its own four async branches. Composition only — read-only save-less view.
 */
export function ProfileTab({
  detail,
  timeline,
  notes,
  onAddNote,
  onRetryTimeline,
  onRetryNotes,
}: UdProfileTabProps) {
  return (
    <div className="grid grid-cols-2 gap-3.5">
      <Panel>
        <div className="mb-3 text-[13px] font-extrabold">Contact & locale</div>
        {[
          { k: "Email", v: detail.email ?? NOT_PROVIDED, mono: false },
          { k: "Phone", v: detail.phone ?? NOT_PROVIDED, mono: true },
          { k: "Country", v: NOT_PROVIDED, mono: false },
          { k: "Locale", v: NOT_PROVIDED, mono: false },
          { k: "Status", v: detail.status, mono: false },
          { k: "Created", v: detail.createdAt, mono: true },
        ].map((c) => (
          <div
            key={c.k}
            className="flex justify-between gap-3 border-b border-line2 py-2"
          >
            <span className="text-[12.5px] text-ink3">{c.k}</span>
            <span
              className={cn(
                "text-right text-[12.5px] font-bold capitalize",
                c.mono && "font-mono"
              )}
            >
              {c.v}
            </span>
          </div>
        ))}
      </Panel>
      <Panel>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[13px] font-extrabold">
            Admin action timeline
          </div>
          <button
            type="button"
            onClick={onAddNote}
            className="cursor-pointer text-xs font-bold text-tif focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            + Add note
          </button>
        </div>
        {timeline.isLoading && (
          <div className="space-y-3 py-2" aria-busy="true">
            <Skeleton className="h-8 rounded-lg" />
            <Skeleton className="h-8 rounded-lg" />
          </div>
        )}
        {timeline.isError && (
          <div className="flex items-center justify-between gap-3 py-4">
            <span className="text-[12px] font-bold text-tdn">
              Failed to load the timeline.
            </span>
            <button
              type="button"
              onClick={onRetryTimeline}
              className="cursor-pointer rounded-[9px] border border-line px-3 py-1.5 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}
        {timeline.isSuccess && timeline.data.length === 0 && (
          <div className="py-6 text-center text-[12px] text-ink3">
            No recorded admin actions for this user.
          </div>
        )}
        {timeline.data?.map((t) => (
          <div
            key={t.id}
            className="flex gap-[11px] border-b border-line2 py-[9px]"
          >
            <span
              className="mt-[5px] size-2 flex-none rounded-full"
              style={{ background: actionDot(t.action) }}
            />
            <div className="flex-1">
              <div className="text-[12.5px] font-semibold capitalize">
                {actionLabel(t.action)}
              </div>
              <div className="text-[11px] text-ink3">
                {t.actor} · {t.createdAt}
              </div>
            </div>
          </div>
        ))}

        {/* Case notes — the immutable free-text notes appended via "Add note"
            (POST /admin/users/:id/notes). Its own four async branches. */}
        <div className="mt-4 mb-2.5 text-xs font-extrabold text-ink2">
          Case notes
        </div>
        {notes.isLoading && (
          <div className="space-y-3 py-2" aria-busy="true">
            <Skeleton className="h-8 rounded-lg" />
          </div>
        )}
        {notes.isError && (
          <div className="flex items-center justify-between gap-3 py-4">
            <span className="text-[12px] font-bold text-tdn">
              Failed to load case notes.
            </span>
            <button
              type="button"
              onClick={onRetryNotes}
              className="cursor-pointer rounded-[9px] border border-line px-3 py-1.5 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}
        {notes.isSuccess && notes.data.items.length === 0 && (
          <div className="py-4 text-center text-[12px] text-ink3">
            No case notes for this user.
          </div>
        )}
        {notes.data?.items.map((n) => (
          <div
            key={n.id}
            className="flex gap-[11px] border-b border-line2 py-[9px]"
          >
            <span className="mt-[5px] size-2 flex-none rounded-full bg-[#8b948a]" />
            <div className="flex-1">
              <div className="text-[12.5px] whitespace-pre-wrap">{n.body}</div>
              <div className="text-[11px] text-ink3">
                {n.authorAdminId} · {n.createdAt}
              </div>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  )
}
