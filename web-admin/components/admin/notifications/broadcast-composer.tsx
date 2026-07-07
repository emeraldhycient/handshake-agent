"use client"

import { MakerCheckerModal, StepUpModal } from "@/components/admin/flows"
import { TemplateEditorDialog } from "@/components/admin/template-editor-dialog"
import { NativeSelect } from "@/components/ui/native-select"
import { useBroadcastComposer } from "@/lib/hooks/use-broadcast-composer"
import { MakerCheckerWarning } from "@/components/admin/notifications/maker-checker-warning"
import { AUDIENCE_OPTIONS, SCHEDULE_OPTIONS } from "@/constants/notifications"

/** An uppercase eyebrow label above a composer field (design 11px/700 ink3). */
function FieldLabel({ children }: { children: string }) {
  return (
    <div className="mb-[5px] text-[11px] font-bold text-ink3">{children}</div>
  )
}

/** The broadcast composer: Audience / Template / Schedule + the `bBig` warning + CTA. */
export function BroadcastComposer() {
  const c = useBroadcastComposer()

  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3.5 text-[13px] font-extrabold text-ink">
        Broadcast composer
      </div>

      <div className="flex flex-col gap-[11px]">
        <div>
          <FieldLabel>AUDIENCE</FieldLabel>
          <NativeSelect
            aria-label="Broadcast audience"
            className="h-10 rounded-[10px] text-[13px] font-semibold"
            value={c.audience}
            onChange={c.onAudienceChange}
          >
            {AUDIENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div>
          <div className="mb-[5px] flex items-center justify-between">
            <FieldLabel>TEMPLATE</FieldLabel>
            <button
              type="button"
              onClick={() => c.setEditorOpen(true)}
              className="text-[11px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              New template
            </button>
          </div>
          <NativeSelect
            aria-label="Broadcast template"
            className="h-10 rounded-[10px] text-[13px] font-semibold"
            value={c.selectedTemplate}
            onChange={c.onTemplateChange}
          >
            {c.templateOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div>
          <FieldLabel>SCHEDULE</FieldLabel>
          <NativeSelect
            aria-label="Broadcast schedule"
            className="h-10 rounded-[10px] text-[13px] font-semibold"
            value={c.when}
            onChange={c.onScheduleChange}
          >
            {SCHEDULE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>

          {c.isCustomSchedule && (
            <input
              type="datetime-local"
              aria-label="Custom send time"
              value={c.customAt}
              onChange={c.onCustomAtChange}
              className="mt-[7px] h-10 w-full rounded-[10px] border border-line bg-field px-3 text-[13px] font-semibold text-ink transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          )}
        </div>

        {c.isBroadAudience && <MakerCheckerWarning />}

        <button
          type="button"
          onClick={c.queueBroadcast}
          aria-label={c.ctaLabel}
          className="rounded-[11px] bg-brand-amber px-3 py-3 text-center text-[13.5px] font-extrabold text-[--ink-on-amber] transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {c.ctaLabel}
        </button>
      </div>

      <MakerCheckerModal
        open={c.confirmOpen}
        onOpenChange={c.setConfirmOpen}
        title="Confirm broadcast"
        diff={[
          { field: "Audience", from: "—", to: c.audienceLabel },
          { field: "Template", from: "—", to: c.selectedTemplate },
          { field: "Schedule", from: "—", to: c.scheduleLabel },
        ]}
        onSubmit={() => void c.submitBroadcast()}
      />

      {/* Step-up (TOTP) — opened when the send 403s; on completion the send replays. */}
      <StepUpModal
        open={c.stepUp.open}
        onOpenChange={c.stepUp.setOpen}
        title="send broadcast"
        onComplete={() => void c.retryAfterStepUp()}
      />

      {/* Author a new notification template inline (POST via useUpsertTemplate). */}
      <TemplateEditorDialog
        open={c.editorOpen}
        onOpenChange={c.setEditorOpen}
        template={null}
      />
    </div>
  )
}
