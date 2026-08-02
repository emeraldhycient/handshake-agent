"use client"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useWebhookDetail } from "@/lib/query/hooks"
import { STATUS_VARIANT } from "@/constants/webhooks"
import { formatDate, prettyJson } from "@/lib/webhooks/format"
import type { WebhookDetailDrawerProps } from "@/types"

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[12.5px] text-ink3">{label}</dt>
      <dd className="text-[12.5px] font-semibold text-ink tabular-nums">
        {value}
      </dd>
    </>
  )
}

/**
 * The webhook detail drawer — fetches via `useWebhookDetail(id)` and renders the metadata,
 * the last error (if any), the verbatim payload + headers as pretty JSON, and the Retry
 * action. Four async branches on the detail query.
 */
export function WebhookDetailDrawer({
  webhookId,
  onOpenChange,
  onRetry,
  retrying,
}: WebhookDetailDrawerProps) {
  const detail = useWebhookDetail(webhookId)
  const webhook = detail.data

  return (
    <Sheet open={webhookId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Webhook</SheetTitle>
          <SheetDescription>
            {webhook ? webhook.provider : "Loading webhook"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 p-4 pt-0">
          {detail.isLoading && (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-24 w-full rounded-md" />
              <Skeleton className="h-24 w-full rounded-md" />
            </div>
          )}

          {detail.isError && (
            <div className="rounded-[14px] border border-sdn bg-sdn/40 p-5 text-center">
              <p className="text-sm font-bold text-tdn">
                Failed to load this webhook
              </p>
              <p className="mt-1 text-xs text-ink2">Close and try again.</p>
            </div>
          )}

          {detail.isSuccess && webhook && (
            <>
              <section className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[webhook.status]}>
                    {webhook.status}
                  </Badge>
                  <span className="text-[12.5px] text-ink2">
                    {webhook.attempts} attempt
                    {webhook.attempts === 1 ? "" : "s"}
                  </span>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                  <DetailField label="Provider" value={webhook.provider} />
                  <dt className="text-[12.5px] text-ink3">Event ID</dt>
                  <dd className="font-mono text-[12.5px] font-semibold break-all text-ink">
                    {webhook.providerEventId}
                  </dd>
                  <DetailField
                    label="Received"
                    value={formatDate(webhook.receivedAt)}
                  />
                  <DetailField
                    label="Last attempt"
                    value={formatDate(webhook.lastAttemptAt)}
                  />
                  <DetailField
                    label="Processed"
                    value={formatDate(webhook.processedAt)}
                  />
                  <DetailField
                    label="Dead-lettered"
                    value={formatDate(webhook.deadAt)}
                  />
                </dl>
              </section>

              {webhook.lastError && (
                <section className="rounded-[12px] border border-sdn bg-sdn/40 px-4 py-3">
                  <div className="text-[10px] font-bold tracking-[0.06em] text-tdn uppercase">
                    Last error
                  </div>
                  <p className="mt-1 text-[12.5px] break-words text-tdn">
                    {webhook.lastError}
                  </p>
                </section>
              )}

              <section className="flex flex-col gap-2">
                <h3 className="text-[11px] font-bold tracking-widest text-ink3 uppercase">
                  Payload
                </h3>
                <pre className="max-h-64 overflow-auto rounded-md border border-line bg-card2 p-3 text-[11px] text-ink2">
                  {prettyJson(webhook.payload)}
                </pre>
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-[11px] font-bold tracking-widest text-ink3 uppercase">
                  Headers
                </h3>
                <pre className="max-h-48 overflow-auto rounded-md border border-line bg-card2 p-3 text-[11px] text-ink2">
                  {prettyJson(webhook.headers)}
                </pre>
              </section>

              <button
                type="button"
                onClick={() => onRetry(webhook.id)}
                disabled={retrying}
                aria-busy={retrying}
                className="cursor-pointer self-start rounded-[10px] bg-btn-dark px-[15px] py-2.5 text-sm font-extrabold text-white transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              >
                {retrying ? "Retrying…" : "Retry"}
              </button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
