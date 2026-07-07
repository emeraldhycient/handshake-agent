import { AssetIcon } from "@/components/shared/asset-icon"
import { Money } from "@/components/shared/money"
import type { WalletAssetCardsProps } from "@/types/wallet"

/** 3-column grid of the user's holdings (per-asset value + crypto amount). */
export function WalletAssetCards({ assets }: WalletAssetCardsProps) {
  return (
    <div className="grid grid-cols-3 gap-[14px]">
      {assets.map((a) => (
        <div
          key={a.sym + a.name}
          className="rounded-[16px] border border-border bg-card p-4"
        >
          <div className="flex items-center gap-[10px]">
            <AssetIcon
              sym={a.sym}
              tint={a.tint}
              logoUrl={a.logoUrl}
              size="sm"
            />
            <div>
              <p className="text-[13.5px] font-bold text-foreground">
                {a.name}
              </p>
              <p className="text-[11.5px] text-muted-foreground">{a.sub}</p>
            </div>
          </div>
          <Money
            value={a.value}
            as="div"
            className="mt-[13px] text-[22px] font-extrabold tracking-tight text-foreground"
          />
          {/* a.amount shows the crypto balance; a.change is "—" (no 24h-change source) */}
          <p className="mt-0.5 text-[12.5px] text-muted-foreground tabular-nums">
            {a.amount}
          </p>
        </div>
      ))}
    </div>
  )
}
