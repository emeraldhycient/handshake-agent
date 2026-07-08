import { StatusPill } from "@/components/shared/status-pill"
import { DetailRow } from "@/components/shared/detail-row"
import { explorerTxUrl } from "@/lib/explorer"
import {
  toneFor,
  titleCase,
  shortHash,
  shortAddress,
  formatDate,
} from "@/lib/transaction/format"
import type { TransactionDetailBodyProps } from "@/types/transaction"

/** The populated body of the transaction-detail modal (status + all fields). */
export function TransactionDetailBody({ data }: TransactionDetailBodyProps) {
  return (
    <div className="divide-y divide-border px-5 pt-2 pb-5">
      {/* Status header */}
      <div className="flex items-center justify-between pb-3">
        <StatusPill tone={toneFor(data.status)}>
          {titleCase(data.status)}
        </StatusPill>
        {data.direction && (
          <span className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
            {data.direction === "in" ? "Inbound" : "Outbound"}
          </span>
        )}
      </div>

      <div className="divide-y divide-border/60">
        {data.cryptoAmount && data.asset && (
          <DetailRow
            label="Amount"
            value={`${data.cryptoAmount} ${data.asset}`}
          />
        )}
        {data.fiatAmount && data.fiatCurrency && (
          <DetailRow
            label={data.type === "buy" ? "You paid" : "Fiat value"}
            value={`${data.fiatCurrency} ${data.fiatAmount}`}
          />
        )}
        {data.fees && <DetailRow label="Network fee" value={data.fees} />}

        {data.network && (
          <DetailRow label="Network" value={data.network.toUpperCase()} />
        )}

        {data.counterparty && (
          <DetailRow
            label={data.direction === "in" ? "From" : "To"}
            value={
              <span className="font-mono" translate="no">
                {shortAddress(data.counterparty)}
              </span>
            }
            copyValue={data.counterparty}
          />
        )}

        {data.txHash && (
          <DetailRow
            label="Tx hash"
            value={
              <span className="font-mono" translate="no">
                {shortHash(data.txHash)}
              </span>
            }
            copyValue={data.txHash}
            explorerHref={
              explorerTxUrl(data.network ?? "", data.txHash) ?? undefined
            }
          />
        )}

        {data.blockNumber !== undefined && (
          <DetailRow
            label="Block"
            value={`#${data.blockNumber.toLocaleString()}`}
          />
        )}
        {data.confirmations !== undefined && (
          <DetailRow label="Confirmations" value={String(data.confirmations)} />
        )}

        {data.payment && (
          <>
            <DetailRow label="Bank" value={data.payment.bankName} />
            <DetailRow
              label="Account"
              value={data.payment.accountNumber}
              mono
              copyValue={data.payment.accountNumber}
            />
          </>
        )}

        {data.receiptNumber && (
          <DetailRow
            label="Receipt number"
            value={data.receiptNumber}
            mono
            copyValue={data.receiptNumber}
          />
        )}
        {data.payment?.providerRef && (
          <DetailRow
            label="Provider reference"
            value={data.payment.providerRef}
            mono
            copyValue={data.payment.providerRef}
          />
        )}
        {data.id && (
          <DetailRow
            label="Transaction ID"
            value={
              <span className="font-mono" translate="no">
                {shortHash(data.id)}
              </span>
            }
            copyValue={data.id}
          />
        )}

        <DetailRow label="Date" value={formatDate(data.createdAt)} />
      </div>
    </div>
  )
}
