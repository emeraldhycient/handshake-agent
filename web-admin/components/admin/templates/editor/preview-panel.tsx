"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { usePreviewTemplate } from "@/lib/query/hooks"
import { toErrorMessage } from "@/lib/error-message"
import { parseSampleVariables } from "@/lib/notifications/template-editor"
import { TEXTAREA_CLASS } from "@/constants/template-editor"
import type { PreviewPanelProps } from "@/types/components"

/** The live-preview panel — sample vars input + Preview button + rendered output. */
export function PreviewPanel({
  contentText,
  subject,
  disabled,
}: PreviewPanelProps) {
  const preview = usePreviewTemplate()
  const [sample, setSample] = useState("{}")
  const [localError, setLocalError] = useState<string | null>(null)

  function onPreview() {
    setLocalError(null)
    const parsed = parseSampleVariables(sample)
    if (!parsed.ok) {
      setLocalError(parsed.error)
      return
    }
    preview.mutate({
      contentText,
      ...(subject.trim() ? { subject } : {}),
      variables: parsed.value,
    })
  }

  const serverError = preview.isError ? toErrorMessage(preview.error) : null

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-card2 p-4">
      <p className="text-[11px] font-bold tracking-wider text-ink3 uppercase">
        Live preview
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="preview-sample">Sample variables (JSON)</Label>
        <textarea
          id="preview-sample"
          value={sample}
          disabled={disabled}
          spellCheck={false}
          rows={3}
          onChange={(e) => setSample(e.target.value)}
          className={`${TEXTAREA_CLASS} font-mono text-xs`}
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="self-start"
        disabled={disabled || preview.isPending}
        aria-busy={preview.isPending}
        onClick={onPreview}
      >
        Preview
      </Button>

      {(localError ?? serverError) && (
        <p role="alert" className="text-xs text-tdn">
          {localError ?? serverError}
        </p>
      )}

      {preview.isSuccess && (
        <div className="flex flex-col gap-2">
          {preview.data.renderedSubject !== null && (
            <div className="flex flex-col gap-0.5">
              <p className="text-[11px] font-bold tracking-wider text-ink3 uppercase">
                Rendered subject
              </p>
              <p className="text-sm font-semibold text-ink">
                {preview.data.renderedSubject}
              </p>
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            <p className="text-[11px] font-bold tracking-wider text-ink3 uppercase">
              Rendered text
            </p>
            <pre className="max-h-40 overflow-auto rounded-[10px] border border-line bg-card p-3 text-xs whitespace-pre-wrap text-ink">
              {preview.data.renderedText}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
