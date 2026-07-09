"use client"

/**
 * SettingsPage — the layered-config (AppSetting) console (design §6.30), WIRED to
 * `useSettings()`. Orchestrator: pulls the editor state machine from `useSettingsEditor`
 * and composes the header, the key-search box, the settings table, and the shared
 * funds-safety edit chain (value → reason → confirm → the real step-up-guarded PATCH).
 * The PATCH re-validates + hot-reloads + audits `config_change` server-side — it never
 * moves money (§3.1/§3.2). A 403 opens the StepUpDialog and the PATCH replays on re-auth.
 */
import { MakerCheckerModal, ReasonModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useSettingsEditor } from "@/lib/hooks/use-settings-editor"
import { SettingsTable } from "@/components/admin/settings/settings-table"
import { SettingValueModal } from "@/components/admin/settings/setting-value-modal"
import { settingDiff } from "@/lib/settings/rows"

export function SettingsPage() {
  const s = useSettingsEditor()

  return (
    <div className="mx-auto w-full max-w-[1300px] px-[30px] pt-[26px] pb-[60px]">
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Settings
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Every tunable key. Effective value resolves DB-admin › ENV › JSON. You
          may edit the DB layer only — edits enter maker-checker, then
          hot-reload.
        </p>
      </div>

      {/* Key search (filters the rows; presentation only) */}
      <div className="mb-3.5 flex h-[38px] max-w-[340px] items-center gap-2 rounded-[11px] border border-line bg-card px-3">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="text-ink3"
        >
          <circle
            cx="11"
            cy="11"
            r="7"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="m20 20-3.5-3.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <input
          value={s.search}
          onChange={(e) => s.setSearch(e.target.value)}
          placeholder="Search keys…"
          aria-label="Search settings keys"
          className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-ink outline-none placeholder:text-ink3"
        />
      </div>

      <SettingsTable
        rows={s.visibleRows}
        totalCount={s.rows.length}
        isLoading={s.query.isLoading}
        isError={s.query.isError}
        isSuccess={s.query.isSuccess}
        search={s.search}
        onRetry={() => s.query.refetch()}
        onEdit={s.startEdit}
      />

      {/* Funds-safety flow chain: value → reason → confirm. The REAL step-up is
          server-driven — the PATCH 403s and the StepUpDialog below replays it. */}
      <SettingValueModal
        open={s.step === "value"}
        row={s.editing}
        onOpenChange={(next) => (next ? undefined : s.closeFlow())}
        onContinue={s.onValueContinue}
      />
      <ReasonModal
        open={s.step === "reason"}
        onOpenChange={(next) => (next ? undefined : s.closeFlow())}
        title={s.flowTitle}
        onContinue={s.onReasonContinue}
      />
      <MakerCheckerModal
        open={s.step === "maker"}
        onOpenChange={(next) => (next ? undefined : s.closeFlow())}
        title={s.flowTitle}
        diff={s.editing ? settingDiff(s.editing, s.nextDisplay) : []}
        onSubmit={s.applyOverride}
      />

      {/* Server-side step-up re-auth: a 403 on the PATCH opens this; the override
          replays after re-authentication. */}
      <StepUpDialog
        open={s.stepUp.open}
        mfaEnabled={s.me.data?.mfaEnabled ?? false}
        onOpenChange={s.stepUp.setOpen}
        onSuccess={s.onStepUpSuccess}
      />
    </div>
  )
}
