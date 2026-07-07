import { formatCryptoAmount } from "@/lib/format"
import { fmtFiat, statusMeta } from "@/lib/users/user-detail"
import { NOT_PROVIDED, TYPE_ICON } from "@/constants/user-detail"
import type { UdTransactionsTabProps } from "@/types/components"

/** The Transactions tab — the user's recent transactions; each row opens the tx detail. */
export function TransactionsTab({
  transactions,
  onOpenTx,
}: UdTransactionsTabProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      {transactions.length === 0 ? (
        <div className="py-8 text-center text-[12.5px] text-ink3">
          No transactions for this user.
        </div>
      ) : (
        transactions.map((t) => {
          const sm = statusMeta(t.status)
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onOpenTx(t.id)}
              className="grid w-full cursor-pointer grid-cols-[1.2fr_1fr_1fr_1fr] items-center gap-3 border-b border-line2 p-[13px_18px] text-left transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <div className="flex items-center gap-[9px]">
                <span className="flex size-[30px] flex-none items-center justify-center rounded-lg bg-card2 text-ink2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d={TYPE_ICON[t.type] ?? TYPE_ICON.buy}
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div>
                  <div className="text-[12.5px] font-bold capitalize">{t.type}</div>
                  <div className="font-mono text-[10.5px] text-ink3">{t.id}</div>
                </div>
              </div>
              {/* Amount (crypto leg) + NGN fiat leg projected from metadata. */}
              <div className="font-mono text-[12.5px] font-bold tabular-nums">
                {t.amount !== null ? (
                  <>
                    {formatCryptoAmount(t.amount)}
                    {t.asset && (
                      <span className="ml-1 text-[10.5px] text-ink3">{t.asset}</span>
                    )}
                    <div className="text-[10.5px] font-semibold text-ink3">
                      {fmtFiat(t.fiatAmount, t.fiatCurrency)}
                    </div>
                  </>
                ) : (
                  <span className="text-ink3">{NOT_PROVIDED}</span>
                )}
              </div>
              <div className="text-xs text-ink2 tabular-nums">{t.createdAt}</div>
              <div>
                <span
                  className="rounded-full px-[9px] py-[3px] text-[10.5px] font-bold capitalize"
                  style={{ background: sm.bg, color: sm.fg }}
                >
                  {sm.l}
                </span>
              </div>
            </button>
          )
        })
      )}
    </div>
  )
}
