import Link from "next/link"

import { LEDGER_GRID } from "@/constants/ledger"
import type { LedgerRowLineProps } from "@/types/components"

/** One ledger body row — Seq · Account · Dir · Amount · Running · Source (design §6.11). */
export function LedgerRowLine({ row }: LedgerRowLineProps) {
  return (
    <div
      className={`${LEDGER_GRID} items-center border-b border-line2 py-[11px] last:border-b-0`}
    >
      <div className="font-mono text-[11px] text-ink3 tabular-nums">
        {row.seq}
      </div>
      <div className="font-mono text-[12px] text-ink2">{row.acct}</div>
      <div>
        <span
          className={`text-[10.5px] font-extrabold ${
            row.dirDanger ? "text-tdn" : "text-tok"
          }`}
        >
          {row.dir}
        </span>
      </div>
      <div className="text-right font-mono text-[12px] font-bold tabular-nums">
        {row.amt}
      </div>
      <div className="text-right font-mono text-[12px] text-ink2 tabular-nums">
        {row.run}
      </div>
      <div>
        {row.href ? (
          <Link
            href={row.href}
            className="font-mono text-[11.5px] font-bold text-tif hover:underline"
          >
            {row.src}
          </Link>
        ) : (
          <span className="font-mono text-[11.5px] font-bold text-tif">
            {row.src}
          </span>
        )}
      </div>
    </div>
  )
}
