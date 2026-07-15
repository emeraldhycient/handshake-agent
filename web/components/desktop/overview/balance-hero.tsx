import { Money } from "@/components/shared/money"
import { HERO_ACTIONS } from "@/constants/overview"
import { chipLabel } from "@/lib/chat/flow"
import { cn } from "@/lib/utils"
import type { BalanceHeroProps } from "@/types/overview"

/** Balance hero + quick-action buttons. Sell is hidden until crypto.sell is on. */
export function BalanceHero({
  total,
  canSell,
  onQuickAction,
}: BalanceHeroProps) {
  const actions = canSell
    ? HERO_ACTIONS
    : HERO_ACTIONS.filter((a) => a.action !== "sell")

  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-5 rounded-[18px] bg-gradient-to-b from-primary to-primary-deep px-[26px] py-6 text-primary-foreground">
      <div className="flex-1">
        <p className="text-[13px] font-semibold text-primary-foreground/70">
          Total balance
        </p>
        <Money
          value={total}
          as="div"
          className="mt-0.5 text-[40px] font-extrabold tracking-tight tabular-nums"
        />
      </div>
      <div className="flex gap-[10px]">
        {actions.map(({ action, label, primary }) => (
          <button
            key={action}
            type="button"
            aria-label={label}
            onClick={() => onQuickAction(action, chipLabel(action))}
            className={cn(
              "cursor-pointer rounded-[12px] px-5 py-[11px] text-sm font-bold transition-opacity outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary-foreground/80 focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
              primary
                ? "bg-accent text-accent-foreground"
                : "border border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
