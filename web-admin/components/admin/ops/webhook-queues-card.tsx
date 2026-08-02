"use client"

import { cn } from "@/lib/utils"
import { HEALTH_TEXT, QUEUE_STATUS_LABEL } from "@/constants/ops"
import type { WebhookQueuesCardProps } from "@/types"

/** Left panel — Webhook queues (mono name + depth/retries + status). */
export function WebhookQueuesCard({ queues }: WebhookQueuesCardProps) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Webhook queues
      </div>
      {queues.map((queue) => (
        <div
          key={queue.key}
          className="flex items-center gap-[11px] border-b border-line2 py-2.5 last:border-b-0"
        >
          <div className="flex-1">
            <div className="font-mono text-xs font-semibold text-ink">
              {queue.key}
            </div>
            <div className="text-[10.5px] text-ink3">
              depth <span className="tabular-nums">{queue.depth}</span> ·
              retries <span className="tabular-nums">{queue.retries}</span>
            </div>
          </div>
          <span
            className={cn("text-[10.5px] font-bold", HEALTH_TEXT[queue.health])}
          >
            {QUEUE_STATUS_LABEL[queue.health]}
          </span>
        </div>
      ))}
    </div>
  )
}
