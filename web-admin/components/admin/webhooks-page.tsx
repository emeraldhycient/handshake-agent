"use client"

/**
 * WebhooksPage — the durable inbound-webhook console (Track A). Orchestrator: pulls the
 * filter/query + replay state machine from `useWebhooksConsole` and composes the metrics
 * strip, the filter bar, the queue, the detail drawer, and the retry (ReasonModal →
 * step-up) flow. Replay re-enqueues the webhook (engine-brokered, §3.1) — it moves no money.
 */
import { ReasonModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useWebhooksConsole } from "@/lib/hooks/use-webhooks-console"
import { WebhookMetricsStrip } from "@/components/admin/webhooks/webhook-metrics-strip"
import { WebhookFilterBar } from "@/components/admin/webhooks/webhook-filter-bar"
import { WebhookQueue } from "@/components/admin/webhooks/webhook-queue"
import { WebhookDetailDrawer } from "@/components/admin/webhooks/webhook-detail-drawer"

export function WebhooksPage() {
  const w = useWebhooksConsole()

  return (
    <div className="mx-auto w-full max-w-[1120px] px-[30px] pt-[26px] pb-[60px]">
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Webhooks
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Durable record of every inbound provider webhook. Filter, inspect, and
          replay.
        </p>
      </div>

      <WebhookMetricsStrip />

      <WebhookFilterBar filter={w.filter} onChange={w.setFilter} />

      <WebhookQueue
        items={w.items}
        isLoading={w.webhooksQuery.isLoading}
        isError={w.webhooksQuery.isError}
        isSuccess={w.webhooksQuery.isSuccess}
        onRetry={() => void w.webhooksQuery.refetch()}
        onView={w.setSelectedId}
      />

      <WebhookDetailDrawer
        webhookId={w.selectedId}
        onOpenChange={(open) => !open && w.setSelectedId(null)}
        onRetry={w.setReasonFor}
        retrying={w.retry.isPending}
      />

      {/* Retry → ReasonModal (audited) → step-up-guarded POST */}
      <ReasonModal
        open={w.reasonFor !== null}
        onOpenChange={(next) => !next && w.setReasonFor(null)}
        title="Retry webhook"
        onContinue={(reason) => w.reasonFor && w.replay(w.reasonFor, reason)}
      />

      {/* Server-side step-up re-auth: a 403 on the retry POST opens this. */}
      <StepUpDialog
        open={w.stepUp.open}
        mfaEnabled={w.me.data?.mfaEnabled ?? false}
        onOpenChange={w.stepUp.setOpen}
        onSuccess={w.onStepUpSuccess}
      />
    </div>
  )
}
