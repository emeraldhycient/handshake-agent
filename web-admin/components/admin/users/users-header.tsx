"use client"

import type { UsersHeaderProps } from "@/types"

/** Users-directory header — the title + shown/total count and CSV export. */
export function UsersHeader({
  shown,
  total,
  moreAvailable,
  exporting,
  onExport,
}: UsersHeaderProps) {
  return (
    <div className="mb-[18px] flex flex-wrap items-end justify-between gap-5">
      <div>
        <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Users
        </h1>
        <p className="mt-[5px] mb-0 text-[13.5px] text-ink2">
          <span className="tabular-nums">{shown}</span> shown
          {typeof total === "number" ? (
            <>
              {" · "}
              <span className="tabular-nums">
                {total.toLocaleString()}
              </span>{" "}
              total
            </>
          ) : (
            moreAvailable && " · more available"
          )}
        </p>
      </div>
      <div className="flex gap-[9px]">
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="flex h-[38px] items-center gap-[7px] rounded-[11px] border border-line bg-card px-[15px] text-[13px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
    </div>
  )
}
