import {
  DIFF_ARROW,
  INBOX_ZERO_CHECK,
  OWN_REQUEST_WARN,
  REASON_ICON,
} from "@/constants/approvals"

/** A document / reason glyph for the reason box (design line 16). */
export function ReasonIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="mt-px shrink-0 text-ink3"
    >
      <path
        d={REASON_ICON}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The from→to arrow that separates the struck-through old value from the new. */
export function DiffArrow() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-ink3"
    >
      <path
        d={DIFF_ARROW}
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The warning triangle on the dual-control "your own request" guard. */
export function OwnRequestIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={OWN_REQUEST_WARN}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The inbox-zero checkmark (design line 7). */
export function InboxZeroCheck() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={INBOX_ZERO_CHECK}
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
