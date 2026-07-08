import { InboxZeroCheck } from "./approval-icons"

/** The "Inbox zero" empty bucket (design line 7). */
export function InboxZero() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[60px] text-center">
      <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-[12px] bg-sok text-tok">
        <InboxZeroCheck />
      </div>
      <div className="text-sm font-bold text-ink">Inbox zero</div>
      <div className="mt-[3px] text-[12.5px] text-ink3">
        Nothing awaiting your approval.
      </div>
    </div>
  )
}
