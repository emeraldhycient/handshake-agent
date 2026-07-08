"use client"

/**
 * TemplatesPage — the notification-template screen (design §6.19). Composition only:
 * `useTemplatesPage` owns the templates read + the editor dialog state; the preview
 * grid + cards live in `components/admin/templates/*`. Create/edit is the shared
 * step-up-gated `TemplateEditorDialog`. Nothing here moves money (§3.1).
 */
import { TemplateEditorDialog } from "@/components/admin/template-editor-dialog"
import { TemplatesGrid } from "@/components/admin/templates/templates-grid"
import { useTemplatesPage } from "@/lib/hooks/use-templates-page"

export function TemplatesPage() {
  const t = useTemplatesPage()

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
              Templates
            </h1>
            <p className="mt-[5px] text-[13.5px] text-ink2">
              Email (Resend) and WhatsApp approved-template management.
            </p>
          </div>
          <button
            type="button"
            onClick={t.openCreate}
            className="shrink-0 rounded-[10px] bg-btn-dark px-3.5 py-2 text-[12.5px] font-extrabold text-white transition-colors hover:bg-btn-dark/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            New template
          </button>
        </div>

        <TemplatesGrid
          isLoading={t.query.isLoading}
          isError={t.query.isError}
          isSuccess={t.query.isSuccess}
          templates={t.templates}
          onEdit={t.openEdit}
          onRetry={() => t.query.refetch()}
        />
      </div>

      {/* Shared create/edit editor (POST/PATCH via useUpsertTemplate + step-up). */}
      <TemplateEditorDialog
        open={t.editorOpen}
        onOpenChange={t.setEditorOpen}
        template={t.editing}
      />
    </div>
  )
}
