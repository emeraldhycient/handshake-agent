"use client"

import {
  WebhookEventStatusSchema,
  WebhookProviderSchema,
} from "@handshake-agent/contracts"

import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import type { WebhookFilterBarProps } from "@/types/components"

/** The webhook-queue filter bar: provider + status + received from/to window. */
export function WebhookFilterBar({ filter, onChange }: WebhookFilterBarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webhook-provider">Provider</Label>
        <NativeSelect
          id="webhook-provider"
          aria-label="Filter by provider"
          className="w-44"
          value={filter.provider}
          onChange={(e) => onChange({ ...filter, provider: e.target.value })}
        >
          <option value="">All providers</option>
          {WebhookProviderSchema.options.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webhook-status">Status</Label>
        <NativeSelect
          id="webhook-status"
          aria-label="Filter by status"
          className="w-40"
          value={filter.status}
          onChange={(e) => onChange({ ...filter, status: e.target.value })}
        >
          <option value="">All statuses</option>
          {WebhookEventStatusSchema.options.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webhook-from">From</Label>
        <input
          id="webhook-from"
          type="date"
          aria-label="Received from"
          value={filter.from}
          onChange={(e) => onChange({ ...filter, from: e.target.value })}
          className="h-[38px] rounded-[11px] border border-line bg-field px-3 text-sm font-semibold text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webhook-to">To</Label>
        <input
          id="webhook-to"
          type="date"
          aria-label="Received to"
          value={filter.to}
          onChange={(e) => onChange({ ...filter, to: e.target.value })}
          className="h-[38px] rounded-[11px] border border-line bg-field px-3 text-sm font-semibold text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
    </div>
  )
}
