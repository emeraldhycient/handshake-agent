"use client"

/**
 * SanctionsPage — the sanctions & screening surface (design §6.5). Orchestrator: pulls the
 * disposition state machine from `useSanctionsDispositions` and composes the screening-match
 * list, the ongoing-monitoring toggles, and the shared Clear/Escalate/Block flow modals.
 * The disposition writes an ANNOTATION (never the immutable screener verdict, §3.1) + an
 * audit; nothing here moves money and PII stays as the stored last-4/ref.
 */
import { useSanctionsDispositions } from "@/lib/hooks/use-sanctions-dispositions"
import { SanctionsMatchList } from "@/components/admin/sanctions/sanctions-match-list"
import { OngoingMonitoring } from "@/components/admin/sanctions/ongoing-monitoring"
import { SanctionsFlowModals } from "@/components/admin/sanctions/sanctions-flow-modals"

export function SanctionsPage() {
  const s = useSanctionsDispositions()

  return (
    <div className="mx-auto w-full max-w-[1120px] px-[30px] pt-[26px] pb-[60px]">
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Sanctions &amp; screening
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Name and address matches from ongoing screening. Clear, escalate, or
          block.
        </p>
      </div>

      <SanctionsMatchList
        records={s.records}
        isLoading={s.sanctions.isLoading}
        isError={s.sanctions.isError}
        isSuccess={s.sanctions.isSuccess}
        onRetry={() => void s.sanctions.refetch()}
        doneOf={s.doneOf}
        onClear={(id) => s.setFlow({ kind: "clear", matchId: id })}
        onEscalate={(id) => s.setFlow({ kind: "escalate", matchId: id })}
        onBlock={(id) =>
          s.setFlow({ kind: "block", matchId: id, step: "reason" })
        }
      />

      <OngoingMonitoring />

      <SanctionsFlowModals
        flow={s.flow}
        labelOf={s.labelOf}
        onClose={() => s.setFlow(null)}
        onDisposition={s.disposition}
        onAdvanceBlock={s.advanceBlock}
        mfaEnabled={s.me.data?.mfaEnabled ?? false}
        stepUpOpen={s.stepUp.open}
        onStepUpOpenChange={s.stepUp.setOpen}
        onStepUpSuccess={s.onStepUpSuccess}
      />
    </div>
  )
}
