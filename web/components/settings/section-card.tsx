import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { SectionCardProps, SettingRowProps } from "@/types"

/**
 * A settings section: an uppercase label + hairline rule (with an optional
 * trailing action, e.g. "Create token") above a bordered card body. Matches the
 * design's section chrome for both densities.
 */
export function SectionCard({
  label,
  density,
  action,
  children,
  className,
}: SectionCardProps) {
  const mobile = density === "mobile"
  return (
    <section>
      <div
        className={cn(
          "flex items-center px-1",
          mobile ? "gap-3 pb-2.5" : "gap-[14px] pb-3"
        )}
      >
        <span
          className={cn(
            "text-[11px] font-bold text-settings-soft uppercase",
            mobile ? "tracking-[0.1em]" : "tracking-[0.11em]"
          )}
        >
          {label}
        </span>
        <span className="h-px flex-1 bg-settings-line" />
        {action}
      </div>
      <div
        className={cn(
          "overflow-hidden border border-border bg-card shadow-[0_1px_2px_rgb(22_38_30/0.03)]",
          mobile ? "rounded-[16px]" : "rounded-[18px]",
          className
        )}
      >
        {children}
      </div>
    </section>
  )
}

/**
 * A single row inside a section card: an icon box + title/subtitle + a trailing
 * slot (button/select). `accentIcon` renders the amber-gradient icon box used by
 * connected agents; otherwise the neutral cream box.
 */
export function SettingRow({
  icon,
  title,
  subtitle,
  trailing,
  density,
  accentIcon,
  first,
  below,
  className,
}: SettingRowProps) {
  const mobile = density === "mobile"
  return (
    <div
      className={cn(
        mobile ? "px-[15px] py-[14px]" : "px-[18px] py-4",
        !first && "border-t border-settings-hairline",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center",
          mobile ? "flex-wrap gap-3" : "flex-wrap gap-x-[14px] gap-y-3"
        )}
      >
        <div
          className={cn(
            "flex flex-none items-center justify-center",
            mobile
              ? "h-[34px] w-[34px] rounded-[10px] [&_svg]:size-[17px]"
              : "h-[38px] w-[38px] rounded-[11px] [&_svg]:size-[18px]",
            accentIcon
              ? "[background:linear-gradient(150deg,var(--color-accent),var(--color-accent-deep))]"
              : "bg-background"
          )}
        >
          {icon}
        </div>
        <div
          className={cn("flex-1", mobile ? "min-w-[130px]" : "min-w-[150px]")}
        >
          <div
            className={cn(
              "font-bold text-foreground",
              mobile ? "text-[14.5px]" : "text-[15px]"
            )}
          >
            {title}
          </div>
          {subtitle != null && (
            <div
              className={cn(
                "mt-px text-settings-soft",
                mobile ? "text-[13px]" : "text-[13.5px]"
              )}
            >
              {subtitle}
            </div>
          )}
        </div>
        {trailing}
      </div>
      {below}
    </div>
  )
}

/** The design's compact pill `<select>` (chevron + cream fill). Row-trailing. */
export function PillSelect({
  value,
  onChange,
  options,
  ariaLabel,
  density,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  ariaLabel: string
  density: "desktop" | "mobile"
}) {
  const mobile = density === "mobile"
  return (
    <div className={cn("relative flex-none", mobile && "ml-auto")}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={cn(
          "cursor-pointer appearance-none rounded-[11px] border border-settings-btn-border bg-card-muted font-semibold text-settings-ink",
          mobile
            ? "py-2 pr-8 pl-3 text-[13px]"
            : "py-[9px] pr-[34px] pl-[13px] text-[13.5px]"
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-settings-label",
          mobile ? "right-[11px]" : "right-3"
        )}
      >
        <path
          d="M3 4.5L6 7.5L9 4.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

/**
 * The destructive row action ("Revoke" / "Disconnect") — the canonical Button
 * primitive (destructive variant, compact size) so it matches the rest of the app.
 */
export function DangerButton({
  children,
  onClick,
  ariaLabel,
}: {
  children: React.ReactNode
  onClick?: () => void
  ariaLabel?: string
}) {
  return (
    <Button
      type="button"
      variant="destructive"
      size="xl"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn("ml-auto min-w-[160px] flex-none")}
    >
      {children}
    </Button>
  )
}

/**
 * The neutral row action ("Edit" / "Change" / "Claim" / "Add") — the canonical
 * Button primitive (outline, compact size) for consistency with Get Started etc.
 */
export function RowButton({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="xl"
      onClick={onClick}
      className={cn("ml-auto min-w-[160px] flex-none", className)}
    >
      {children}
    </Button>
  )
}
