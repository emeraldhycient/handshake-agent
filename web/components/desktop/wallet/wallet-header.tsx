import { ActionButton } from "@/components/shared/action-button"
import { WALLET_ACTIONS } from "@/constants/wallet"
import { chipLabel } from "@/lib/chat/flow"
import type { WalletHeaderProps } from "@/types/wallet"

/** Wallet page header — title + quick-action buttons. */
export function WalletHeader({ canSwap, onQuickAction }: WalletHeaderProps) {
  const actions = canSwap
    ? WALLET_ACTIONS
    : WALLET_ACTIONS.filter((a) => a.action !== "swap")

  return (
    <div className="flex items-center justify-between">
      <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
        Wallet
      </h1>
      <div className="flex gap-[9px]">
        {actions.map(({ action, label, primary }) => (
          <ActionButton
            key={action}
            label={label}
            variant={primary ? "primary" : "secondary"}
            onClick={() => onQuickAction(action, chipLabel(action))}
          />
        ))}
      </div>
    </div>
  )
}
