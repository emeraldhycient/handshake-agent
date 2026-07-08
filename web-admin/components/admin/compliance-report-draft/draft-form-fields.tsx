"use client"

/**
 * DraftFormFields — the input body of the "Draft compliance report" dialog:
 * report type (sar/str), newline-separated related event ids, and the raw JSON
 * content, plus the inline error. Presentation only; all state + submission live
 * in `useComplianceReportDraft`.
 */
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import {
  MONO_TEXTAREA_CLASS,
  REPORT_TYPES,
} from "@/constants/compliance-report-draft"
import type { DraftFormFieldsProps } from "@/types/components"

export function DraftFormFields({
  reportType,
  onReportTypeChange,
  eventsText,
  onEventsTextChange,
  content,
  onContentChange,
  busy,
  error,
}: DraftFormFieldsProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-type">Report type</Label>
        <NativeSelect
          id="report-type"
          className="w-32"
          value={reportType}
          disabled={busy}
          onChange={(e) =>
            onReportTypeChange(e.target.value as (typeof REPORT_TYPES)[number])
          }
        >
          {REPORT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.toUpperCase()}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-events">Related event ids</Label>
        <textarea
          id="report-events"
          value={eventsText}
          disabled={busy}
          onChange={(e) => onEventsTextChange(e.target.value)}
          placeholder="One event id per line"
          rows={3}
          spellCheck={false}
          className={MONO_TEXTAREA_CLASS}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-content">Content (JSON)</Label>
        <textarea
          id="report-content"
          value={content}
          disabled={busy}
          onChange={(e) => onContentChange(e.target.value)}
          rows={5}
          spellCheck={false}
          className={MONO_TEXTAREA_CLASS}
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
