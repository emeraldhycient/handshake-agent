"use client"

/**
 * TemplateEditorDialog — create or edit a notification template (Phase 4).
 *
 * Fields: templateKey, language, channel (select), subject?, contentText
 * (textarea), contentHtml?, whatsappTemplateId?, and a `variables` editor
 * (name / type / description rows). On edit, the composite key (templateKey +
 * language + channel) is immutable — the PATCH targets that triple.
 *
 * A Live preview panel renders the supplied content with a sample-variables JSON
 * input: the Preview button calls `usePreviewTemplate` (a pure deterministic
 * render — no persistence) and shows the renderedSubject / renderedText returned
 * by the server.
 *
 * Save is sensitive — we attempt the mutation, and if it 403s with
 * ADMIN_STEP_UP_REQUIRED we open the StepUpDialog and retry after re-auth
 * (`useStepUpRetry`). Errors surface inline. The form body mounts only while the
 * dialog is open so its `useState` initializers seed from `template` without a
 * state-syncing effect; closing remounts it fresh.
 */
import { useState } from "react"
import {
  NotificationChannelSchema,
  NotificationTemplateUpsertRequestSchema,
  type TemplateVariable,
} from "@handshake-agent/contracts"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import {
  useAdminMe,
  usePreviewTemplate,
  useUpsertTemplate,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import type { TemplateRef } from "@/lib/api/notifications"
import type { NotificationTemplate } from "@handshake-agent/contracts"
import type { TemplateEditorDialogProps } from "@/types/components"

const CHANNELS = NotificationChannelSchema.options

// Textarea (§5): min-height ~92px, radius 12, bg-field, 1px border-line.
const textareaClass =
  "min-h-[92px] w-full min-w-0 resize-y rounded-xl border border-line bg-field px-3.5 py-3 text-sm text-ink transition-[color,box-shadow] outline-none placeholder:text-ink3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

/** Parse the sample-variables textarea into a flat string record for the render. */
function parseSampleVariables(
  raw: string
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: {} }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return { ok: false, error: "Sample variables must be a JSON object." }
    }
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      out[key] = String(value)
    }
    return { ok: true, value: out }
  } catch {
    return { ok: false, error: "Sample variables is not valid JSON." }
  }
}

/** The variables editor — name / type / description rows with add + remove. */
function VariablesEditor({
  variables,
  onChange,
  disabled,
}: {
  variables: TemplateVariable[]
  onChange: (next: TemplateVariable[]) => void
  disabled: boolean
}) {
  function update(index: number, patch: Partial<TemplateVariable>) {
    onChange(variables.map((v, i) => (i === index ? { ...v, ...patch } : v)))
  }
  function remove(index: number) {
    onChange(variables.filter((_, i) => i !== index))
  }
  function add() {
    onChange([...variables, { name: "", type: "string", description: "" }])
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>Variables</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={add}
        >
          Add variable
        </Button>
      </div>
      {variables.length === 0 ? (
        <p className="text-xs text-ink3">No variables documented.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {variables.map((variable, index) => (
            <li key={index} className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Label
                  htmlFor={`var-name-${index}`}
                  className="text-[11px] font-bold tracking-wider text-ink3 uppercase"
                >
                  Name
                </Label>
                <Input
                  id={`var-name-${index}`}
                  value={variable.name}
                  disabled={disabled}
                  onChange={(e) => update(index, { name: e.target.value })}
                />
              </div>
              <div className="flex w-28 flex-col gap-1">
                <Label
                  htmlFor={`var-type-${index}`}
                  className="text-[11px] font-bold tracking-wider text-ink3 uppercase"
                >
                  Type
                </Label>
                <Input
                  id={`var-type-${index}`}
                  value={variable.type}
                  disabled={disabled}
                  onChange={(e) => update(index, { type: e.target.value })}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label
                  htmlFor={`var-desc-${index}`}
                  className="text-[11px] font-bold tracking-wider text-ink3 uppercase"
                >
                  Description
                </Label>
                <Input
                  id={`var-desc-${index}`}
                  value={variable.description}
                  disabled={disabled}
                  onChange={(e) =>
                    update(index, { description: e.target.value })
                  }
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                aria-label={`Remove variable ${index + 1}`}
                onClick={() => remove(index)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The live-preview panel — sample vars input + Preview button + rendered output. */
function PreviewPanel({
  contentText,
  subject,
  disabled,
}: {
  contentText: string
  subject: string
  disabled: boolean
}) {
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

  const serverError = preview.isError ? errorMessage(preview.error) : null

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
          className={`${textareaClass} font-mono text-xs`}
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

/** The form body — mounted only while open, so initializers seed from `template`. */
function TemplateForm({
  template,
  onClose,
}: {
  template: NotificationTemplate | null
  onClose: () => void
}) {
  const isEdit = template !== null
  const me = useAdminMe()
  const upsert = useUpsertTemplate()
  const stepUp = useStepUpRetry()

  const [templateKey, setTemplateKey] = useState(template?.templateKey ?? "")
  const [language, setLanguage] = useState(template?.language ?? "en")
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>(
    template?.channel ?? CHANNELS[0]
  )
  const [subject, setSubject] = useState(template?.subject ?? "")
  const [contentText, setContentText] = useState(template?.contentText ?? "")
  const [contentHtml, setContentHtml] = useState(template?.contentHtml ?? "")
  const [whatsappTemplateId, setWhatsappTemplateId] = useState(
    template?.whatsappTemplateId ?? ""
  )
  const [variables, setVariables] = useState<TemplateVariable[]>(
    template?.variables ?? []
  )
  const [localError, setLocalError] = useState<string | null>(null)

  function onSubmit() {
    setLocalError(null)
    let body
    try {
      body = NotificationTemplateUpsertRequestSchema.parse({
        templateKey,
        language,
        channel,
        ...(subject.trim() ? { subject } : {}),
        contentText,
        ...(contentHtml.trim() ? { contentHtml } : {}),
        ...(whatsappTemplateId.trim() ? { whatsappTemplateId } : {}),
        variables,
      })
    } catch (error) {
      setLocalError(errorMessage(error))
      return
    }

    const ref: TemplateRef | null = isEdit
      ? {
          templateKey: template.templateKey,
          language: template.language,
          channel: template.channel,
        }
      : null

    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          upsert.mutateAsync({ ref, input: body }).then(() => undefined)
        )
        if (ok) onClose()
      } catch (error) {
        setLocalError(errorMessage(error))
      }
    })()
  }

  const busy = upsert.isPending

  return (
    <>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit template" : "New template"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "templateKey, language and channel are immutable."
              : "Define a multilingual, channel-specific template."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="tpl-key">Template key</Label>
              <Input
                id="tpl-key"
                value={templateKey}
                disabled={busy || isEdit}
                onChange={(e) => setTemplateKey(e.target.value)}
                placeholder="kyc.approved"
              />
            </div>
            <div className="flex w-28 flex-col gap-1.5">
              <Label htmlFor="tpl-language">Language</Label>
              <Input
                id="tpl-language"
                value={language}
                disabled={busy || isEdit}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="en"
              />
            </div>
            <div className="flex w-36 flex-col gap-1.5">
              <Label htmlFor="tpl-channel">Channel</Label>
              <NativeSelect
                id="tpl-channel"
                value={channel}
                disabled={busy || isEdit}
                onChange={(e) =>
                  setChannel(e.target.value as (typeof CHANNELS)[number])
                }
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-subject">Subject (optional)</Label>
            <Input
              id="tpl-subject"
              value={subject}
              disabled={busy}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-content-text">Content text</Label>
            <textarea
              id="tpl-content-text"
              value={contentText}
              disabled={busy}
              onChange={(e) => setContentText(e.target.value)}
              rows={4}
              className={textareaClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-content-html">Content HTML (optional)</Label>
            <textarea
              id="tpl-content-html"
              value={contentHtml}
              disabled={busy}
              onChange={(e) => setContentHtml(e.target.value)}
              rows={3}
              spellCheck={false}
              className={`${textareaClass} font-mono text-xs`}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-wa-id">WhatsApp template ID (optional)</Label>
            <Input
              id="tpl-wa-id"
              value={whatsappTemplateId}
              disabled={busy}
              onChange={(e) => setWhatsappTemplateId(e.target.value)}
            />
          </div>

          <VariablesEditor
            variables={variables}
            onChange={setVariables}
            disabled={busy}
          />

          <PreviewPanel
            contentText={contentText}
            subject={subject}
            disabled={busy}
          />

          {localError && (
            <p role="alert" className="text-xs text-tdn">
              {localError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={busy} aria-busy={busy}>
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .then((ok) => {
              if (ok) onClose()
            })
            .catch((error) => setLocalError(errorMessage(error)))
        }}
      />
    </>
  )
}

export function TemplateEditorDialog({
  open,
  onOpenChange,
  template,
}: TemplateEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <TemplateForm template={template} onClose={() => onOpenChange(false)} />
      )}
    </Dialog>
  )
}
