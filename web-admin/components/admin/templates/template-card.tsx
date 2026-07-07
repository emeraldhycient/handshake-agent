import { cn } from "@/lib/utils"
import { CHANNEL_CLASS, CHANNEL_LABEL } from "@/constants/templates"
import type { TemplateCardProps } from "@/types/components"

/**
 * One template preview card — matches the Templates.html markup exactly: a header row
 * (channel chip · mono name · Edit), a `locale · vars` meta line, and a body preview
 * inset in a `bg-card2` box. Edit opens the shared editor for this template.
 */
export function TemplateCard({ template, onEdit }: TemplateCardProps) {
  return (
    <div className="rounded-[16px] border border-line bg-card px-5 py-[18px]">
      {/* ── Header row: channel chip · mono name · Edit ─────────────────────── */}
      <div className="mb-2.5 flex items-center gap-2.5">
        <span
          className={cn(
            "shrink-0 rounded-md px-[9px] py-[3px] text-[11px] font-bold",
            CHANNEL_CLASS[template.channel]
          )}
        >
          {CHANNEL_LABEL[template.channel]}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-bold text-ink">
          {template.templateKey}
        </span>
        <button
          type="button"
          onClick={() => onEdit(template)}
          aria-label={`Edit ${template.templateKey}`}
          className="shrink-0 rounded-[9px] border border-line bg-card px-3 py-[6px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Edit
        </button>
      </div>

      {/* ── locale · vars line ──────────────────────────────────────────────── */}
      <div className="mb-2 text-[11px] text-ink3">
        locale {template.language} · vars: {template.variables.length}
      </div>

      {/* ── Body preview inset (bg-card2) ───────────────────────────────────── */}
      <div className="rounded-[10px] bg-card2 px-[13px] py-[11px] text-[12px] leading-[1.5] text-ink2">
        {template.contentText}
      </div>
    </div>
  )
}
