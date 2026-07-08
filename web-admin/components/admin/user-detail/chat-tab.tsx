import Link from "next/link"

/**
 * The Chat-history tab. The admin agent-conversations endpoint
 * (GET /admin/agent/conversations) has NO per-user filter yet, so rather than
 * render a fabricated transcript as if it were this user's real history, this tab
 * is an honest empty state pointing at the real (unfiltered) transcript surface:
 * the Agent console's Conversations section.
 */
export function ChatTab() {
  return (
    <div className="max-w-[720px] rounded-2xl border border-line bg-card p-5">
      <div className="mb-4 flex items-center gap-[9px] text-xs text-ink3">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M7 11V8a5 5 0 0 1 10 0v3"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <rect
            x="5"
            y="11"
            width="14"
            height="9"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </svg>
        Read-only transcript · secrets redacted · WhatsApp + web
      </div>

      <div className="rounded-[12px] border border-dashed border-line2 px-4 py-8 text-center">
        <p className="text-[13px] font-bold text-ink">
          No per-user conversation read yet
        </p>
        <p className="mx-auto mt-1.5 max-w-[440px] text-[12px] leading-snug text-ink2">
          The agent conversation log cannot be filtered to a single user yet.
          Until it can, review transcripts (read-only, intent-annotated) in{" "}
          <Link
            href="/agent"
            className="font-bold text-tif underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Agent config → Conversations
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
