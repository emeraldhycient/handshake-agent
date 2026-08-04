import type { PageHeaderProps } from "@/types"

/**
 * Canonical admin page header: the `text-[24px] font-extrabold` title + optional
 * subtitle, with an optional right-aligned actions slot. Replaces the header
 * block hand-rolled across ~23 admin pages (margins are zeroed by preflight, so
 * this is pixel-identical to the inline `m-0`/`mb-0` variants).
 */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          {title}
        </h1>
        {subtitle != null && (
          <p className="mt-[5px] text-[13.5px] text-ink2">{subtitle}</p>
        )}
      </div>
      {actions}
    </div>
  )
}
