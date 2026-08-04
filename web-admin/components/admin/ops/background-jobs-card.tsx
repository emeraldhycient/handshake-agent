"use client"

import { cn } from "@/lib/utils"
import { HEALTH_PILL } from "@/constants/ops"
import type { BackgroundJobsCardProps } from "@/types"

/**
 * Right panel — Background jobs & cron (name + schedule/last + status pill + Run now).
 * "Run now" opens the shared reason → step-up → engine-action flow for its job.
 */
export function BackgroundJobsCard({ jobs, onRun }: BackgroundJobsCardProps) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Background jobs &amp; cron
      </div>
      {jobs.map((job) => (
        <div
          key={job.id}
          className="flex items-center gap-[11px] border-b border-line2 py-[11px] last:border-b-0"
        >
          <div className="flex-1">
            <div className="text-[12.5px] font-bold text-ink">{job.name}</div>
            <div className="font-mono text-[10.5px] text-ink3">
              {job.schedule} · last {job.last}
            </div>
          </div>
          <span
            className={cn(
              "rounded-full px-[9px] py-0.5 text-[10.5px] font-bold",
              HEALTH_PILL[job.health]
            )}
          >
            {job.status}
          </span>
          <button
            type="button"
            onClick={() => onRun(job)}
            aria-label={`Run ${job.name} now`}
            className="text-[11.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Run now
          </button>
        </div>
      ))}
    </div>
  )
}
