import type { CardShellProps, InlineErrorProps } from "@/types/components"

/** A card shell — the design's white rounded-16 panel (padding 18px 20px). */
export function CardShell({ children }: CardShellProps) {
  return (
    <div className="rounded-[16px] border border-line bg-card px-5 py-[18px]">
      {children}
    </div>
  )
}

/** An inline, tokened error row with a retry affordance (§ four-branch). */
export function InlineError({ label, onRetry }: InlineErrorProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-sdn bg-sdn/40 px-3 py-2.5">
      <span className="text-[12px] font-semibold text-tdn">{label}</span>
      <button
        type="button"
        onClick={onRetry}
        className="text-[11.5px] font-bold text-tdn underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Retry
      </button>
    </div>
  )
}

/** The edit pencil on a risk-rule row (design line 7). */
export function EditPencilIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 20h4l10-10-4-4L4 16z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}
