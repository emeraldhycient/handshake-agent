"use client"

/**
 * FlagsPage — the feature-flags operator screen (design §6.28). Composition only:
 * `useFeatureFlags` resolves each flag's effective `on` from the settings registry and
 * drives the dual-control toggle; the list + rows live in `components/admin/flags/*`.
 * Flipping a registry-backed flag routes maker-checker → step-up → the settings PATCH,
 * replayed via the StepUpDialog on a 403. Nothing here moves money (§3.1).
 */
import { MakerCheckerModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { FlagsList } from "@/components/admin/flags/flags-list"
import { useFeatureFlags } from "@/lib/hooks/use-feature-flags"

export function FlagsPage() {
  const f = useFeatureFlags()

  return (
    <div className="mx-auto w-full max-w-[1000px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Feature flags
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Non-pricing product flags with per-cohort / percentage rollout and
          effective-evaluation preview.
        </p>
      </div>

      {/* ── Flag list (loading / error / data) ──────────────────────────────── */}
      <FlagsList
        isLoading={f.query.isLoading}
        isError={f.query.isError}
        isSuccess={f.query.isSuccess}
        rows={f.rows}
        onToggle={f.setPending}
        onRetry={() => f.query.refetch()}
      />

      {/* ── Maker-checker flow (the design's toggle destination) ────────────── */}
      <MakerCheckerModal
        open={f.pending !== null}
        onOpenChange={(open) => {
          if (!open) f.setPending(null)
        }}
        title={
          f.pending
            ? `${f.pending.on ? "Disable" : "Enable"} ${f.pending.key}`
            : "Feature-flag change"
        }
        diff={f.diff}
        onSubmit={f.applyToggle}
      />

      {/* Server-side step-up re-auth: a 403 on the flag PATCH opens this; the PATCH
          replays after re-authentication (settings then invalidate to re-resolve). */}
      <StepUpDialog
        open={f.stepUp.open}
        mfaEnabled={f.me.data?.mfaEnabled ?? false}
        onOpenChange={f.stepUp.setOpen}
        onSuccess={f.onStepUpSuccess}
      />
    </div>
  )
}
