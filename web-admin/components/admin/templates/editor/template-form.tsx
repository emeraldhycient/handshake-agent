"use client"

import {
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
import { CHANNELS, TEXTAREA_CLASS } from "@/constants/template-editor"
import { useTemplateForm } from "@/lib/hooks/use-template-form"
import type { TemplateFormProps } from "@/types/components"

import { VariablesEditor } from "./variables-editor"
import { PreviewPanel } from "./preview-panel"

/** The form body — mounted only while open, so initializers seed from `template`. */
export function TemplateForm({ template, onClose }: TemplateFormProps) {
  const f = useTemplateForm(template, onClose)
  const { fields, set, busy, isEdit } = f

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
                value={fields.templateKey}
                disabled={busy || isEdit}
                onChange={(e) => set.templateKey(e.target.value)}
                placeholder="kyc.approved"
              />
            </div>
            <div className="flex w-28 flex-col gap-1.5">
              <Label htmlFor="tpl-language">Language</Label>
              <Input
                id="tpl-language"
                value={fields.language}
                disabled={busy || isEdit}
                onChange={(e) => set.language(e.target.value)}
                placeholder="en"
              />
            </div>
            <div className="flex w-36 flex-col gap-1.5">
              <Label htmlFor="tpl-channel">Channel</Label>
              <NativeSelect
                id="tpl-channel"
                value={fields.channel}
                disabled={busy || isEdit}
                onChange={(e) =>
                  set.channel(e.target.value as (typeof CHANNELS)[number])
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
              value={fields.subject}
              disabled={busy}
              onChange={(e) => set.subject(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-content-text">Content text</Label>
            <textarea
              id="tpl-content-text"
              value={fields.contentText}
              disabled={busy}
              onChange={(e) => set.contentText(e.target.value)}
              rows={4}
              className={TEXTAREA_CLASS}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-content-html">Content HTML (optional)</Label>
            <textarea
              id="tpl-content-html"
              value={fields.contentHtml}
              disabled={busy}
              onChange={(e) => set.contentHtml(e.target.value)}
              rows={3}
              spellCheck={false}
              className={`${TEXTAREA_CLASS} font-mono text-xs`}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-wa-id">WhatsApp template ID (optional)</Label>
            <Input
              id="tpl-wa-id"
              value={fields.whatsappTemplateId}
              disabled={busy}
              onChange={(e) => set.whatsappTemplateId(e.target.value)}
            />
          </div>

          <VariablesEditor
            variables={fields.variables}
            onChange={set.variables}
            disabled={busy}
          />

          <PreviewPanel
            contentText={fields.contentText}
            subject={fields.subject}
            disabled={busy}
          />

          {f.localError && (
            <p role="alert" className="text-xs text-tdn">
              {f.localError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={f.onSubmit} disabled={busy} aria-busy={busy}>
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <StepUpDialog
        open={f.stepUp.open}
        mfaEnabled={f.me.data?.mfaEnabled ?? false}
        onOpenChange={f.stepUp.setOpen}
        onSuccess={f.onStepUpSuccess}
      />
    </>
  )
}
