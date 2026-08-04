"use client"

/**
 * ExportCsvButton — a small "Export CSV" action (go-readiness #7 per-area export).
 * The caller supplies a `build` thunk (run at click, so serialization is on-demand)
 * returning the header + rows; the button serializes via `toCsv` and downloads via
 * `downloadCsv`. `onDownload` is injectable for tests. Pure UI otherwise.
 */
import { toCsv, downloadCsv } from "@/lib/csv"
import { cn } from "@/lib/utils"
import type { ExportCsvButtonProps } from "@/types"

export function ExportCsvButton({
  filename,
  build,
  label = "Export CSV",
  disabled = false,
  onDownload = downloadCsv,
}: ExportCsvButtonProps) {
  const handleClick = () => {
    if (disabled) return
    const { headers, rows } = build()
    onDownload(filename, toCsv(headers, rows))
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-[9px] border border-line bg-card px-3 py-1.5 text-[12px] font-bold text-ink2 transition-colors outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50",
        disabled && "cursor-not-allowed opacity-50 hover:text-ink2"
      )}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      {label}
    </button>
  )
}
