"use client"

/**
 * OpsPage — the "System / ops" operator screen (design §6.29, `Ops.html`), WIRED to
 * `useOps()`. Orchestrator: pulls the board + "Run now" state machine from `useOpsRun`
 * and composes the provider tiles, webhook-queue / background-job panels, the
 * service-health + wallet-backfill sections, and the shared run-flow + step-up modals.
 * Read-only oversight — it moves no money (§3.1); a manual run is engine-brokered.
 */
import { useOpsRun } from "@/lib/hooks/use-ops-run"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import {
  ProviderTiles,
  ProviderTilesSkeleton,
} from "@/components/admin/ops/provider-tiles"
import { WebhookQueuesCard } from "@/components/admin/ops/webhook-queues-card"
import { BackgroundJobsCard } from "@/components/admin/ops/background-jobs-card"
import { PanelSkeleton } from "@/components/admin/ops/panel-skeleton"
import { ServiceHealthCard } from "@/components/admin/ops/service-health-card"
import { WalletBackfillPanel } from "@/components/admin/ops/wallet-backfill-panel"
import { OpsRunFlow } from "@/components/admin/ops/ops-run-flow"

const PANELS =
  "grid grid-cols-1 items-start gap-[14px] lg:grid-cols-[1fr_1.2fr]"

export function OpsPage() {
  const o = useOpsRun()

  return (
    <div
      data-screen-label="System / ops"
      className="mx-auto w-full max-w-[1300px] px-[30px] pt-[26px] pb-[60px]"
    >
      <div className="mb-4">
        <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          System / ops
        </h1>
        <p className="mt-[5px] mb-0 text-[13.5px] text-ink2">
          Provider board, webhook queues, background jobs and error rates.
        </p>
      </div>

      {o.isLoading && (
        <>
          <ProviderTilesSkeleton />
          <div className={PANELS}>
            <PanelSkeleton />
            <PanelSkeleton />
          </div>
        </>
      )}

      {o.isError && (
        <div className="rounded-2xl border border-line bg-card p-[40px] text-center">
          <p className="text-[13px] font-bold text-tdn">
            Couldn&apos;t load the ops board
          </p>
          <p className="mt-1 text-[12px] text-ink3">
            The provider / queue / job feed is unavailable right now.
          </p>
          <button
            type="button"
            onClick={() => void o.refetch()}
            className="mt-3 inline-flex h-8 items-center rounded-[9px] border border-line bg-card px-3.5 text-[12px] font-bold text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {o.isEmpty && (
        <div className="rounded-2xl border border-line bg-card p-[50px] text-center text-[13px] text-ink3">
          No providers, queues, or jobs registered.
        </div>
      )}

      {o.isSuccess && !o.isEmpty && o.data && (
        <>
          <ProviderTiles providers={o.data.providers} />
          <div className={PANELS}>
            <WebhookQueuesCard queues={o.data.webhookQueues} />
            <BackgroundJobsCard jobs={o.jobs} onRun={o.openRun} />
          </div>
        </>
      )}

      {/* Independent queries — each renders regardless of the board state. */}
      <ServiceHealthCard />
      <WalletBackfillPanel />

      {o.active && (
        <OpsRunFlow
          job={o.active.job}
          stage={o.active.stage}
          onClose={o.closeFlow}
          onContinue={o.advanceToEngine}
          onExecute={o.executeRun}
        />
      )}

      <StepUpDialog
        open={o.stepUp.open}
        mfaEnabled={o.me.data?.mfaEnabled ?? false}
        onOpenChange={o.stepUp.setOpen}
        onSuccess={o.onStepUpSuccess}
      />
      {o.localError && (
        <p role="alert" className="mt-3 text-[12px] font-semibold text-tdn">
          {o.localError}
        </p>
      )}
    </div>
  )
}
