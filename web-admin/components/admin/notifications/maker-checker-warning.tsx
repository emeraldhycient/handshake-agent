/** The broad-audience maker-checker advisory (design's `sc-if bBig`). */
export function MakerCheckerWarning() {
  return (
    <div className="flex items-center gap-2 rounded-[9px] bg-swn px-3 py-[9px]">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="shrink-0 text-twn"
      >
        <path
          d="M12 4l9 16H3z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[11px] font-semibold text-twn">
        Broad audience — the server may require maker-checker approval.
      </span>
    </div>
  )
}
