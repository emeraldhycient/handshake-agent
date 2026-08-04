import { Skeleton } from "@/components/ui/skeleton"
import type { TemplatesGridProps } from "@/types"

import { TemplateCard } from "./template-card"

/**
 * The template preview region — the four async branches (loading skeletons / error with
 * inline retry / empty / the 1fr·1fr grid of preview cards) over the templates read.
 */
export function TemplatesGrid({
  isLoading,
  isError,
  isSuccess,
  templates,
  onEdit,
  onRetry,
}: TemplatesGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[152px] rounded-[16px]" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-[16px] border border-sdn bg-sdn/40 p-6 text-center">
        <p className="text-sm font-bold text-tdn">
          Couldn&apos;t load templates
        </p>
        <p className="mt-1 text-[12.5px] text-ink2">Please try again.</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-[10px] border border-line bg-card px-3.5 py-1.5 text-[12.5px] font-bold text-ink transition-colors hover:bg-card2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!isSuccess) return null

  if (templates.length === 0) {
    return (
      <div className="rounded-[16px] border border-line bg-card p-10 text-center">
        <p className="text-[13.5px] font-bold text-ink">No templates yet</p>
        <p className="mt-1 text-[12.5px] text-ink2">
          Email and WhatsApp templates you create will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
      {templates.map((template) => (
        <TemplateCard key={template.id} template={template} onEdit={onEdit} />
      ))}
    </div>
  )
}
