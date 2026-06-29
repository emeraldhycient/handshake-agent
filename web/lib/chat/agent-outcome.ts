/**
 * Pure mapping from an agent turn `AgentTurnOutcome` to renderable chat messages.
 *
 * This is the single source of truth for how a server outcome becomes
 * `ChatMessage`s. Both the live send path (`chat-store.sendToAgent`) and the
 * reload/hydration path (`chat-store.hydrateHistory`) call it, so a live reply
 * and a reloaded reply render identically.
 *
 * SACROSANCT INVARIANT (CLAUDE.md §3.1): this never produces a `receipt`-kind
 * message — receipts are appended exclusively by `pinComplete()`.
 */

import type {
  AgentTurnOutcome,
  BuyProposalConfirmation,
  SellProposalConfirmation,
  SendProposalConfirmation,
  SwapProposalConfirmation,
} from "@handshake-agent/contracts"
import type { ChatAction, ChatMessage } from "@/lib/schemas"
import { formatNGN } from "@/lib/format"
import { ASSET_NAMES, ASSET_TINTS } from "@/lib/constants"

export interface MappedOutcome {
  /** Assistant messages to append for this turn. */
  messages: ChatMessage[]
  /** Proposal id to stash for the execute phase, or null for non-proposal turns. */
  proposalId: string | null
}

export function mapOutcomeToMessages(
  outcome: AgentTurnOutcome,
  makeId: () => string
): MappedOutcome {
  const messages: ChatMessage[] = []
  let proposalId: string | null = null

  if (outcome.kind === "clarification") {
    messages.push({
      id: makeId(),
      role: "assistant",
      kind: "text",
      text: outcome.text,
    })
  } else if (outcome.kind === "receive") {
    const d = outcome.deposit
    messages.push({
      id: makeId(),
      role: "assistant",
      kind: "receive",
      asset: d.asset,
      network: d.network,
      address: d.address,
      minDeposit: d.minAmount ?? "—",
      creditedEta: d.etaText ?? "~30 min",
    })
  } else if (outcome.kind === "proposal") {
    const c = outcome.confirmation
    const lockSeconds = Math.max(
      0,
      Math.round((new Date(c.expiresAt).getTime() - Date.now()) / 1000)
    )

    if (outcome.txType === "swap") {
      // outcome.txType === 'swap' guarantees the server sent SwapProposalConfirmation (schema-validated at ingress).
      // Emit a dedicated `swap` kind message so SwapCard renders typed crypto fields
      // (fromAsset→toAsset, per-asset amounts, ETA) — no FX spread line (§3.1).
      const sw = c as SwapProposalConfirmation
      messages.push({
        id: makeId(),
        role: "assistant",
        kind: "swap",
        fromAsset: sw.fromAsset,
        toAsset: sw.toAsset,
        fromAmount: sw.fromAmount,
        toAmount: sw.toAmount,
        rate: sw.rate,
        networkFee: sw.networkFee,
        transactionFee: sw.transactionFee,
        estimatedArrivalSec: sw.estimatedArrivalSec,
        expiresAt: sw.expiresAt,
        lockSeconds,
      })
    } else {
      const rows: Array<{ label: string; value: string }> = []
      let receiveAmt = ""
      let receiveSub = ""
      let totalLabel = "Total"
      let totalValue = ""

      if (outcome.txType === "buy") {
        // outcome.txType === 'buy' guarantees the server sent BuyProposalConfirmation (schema-validated at ingress)
        const b = c as BuyProposalConfirmation
        receiveAmt = b.cryptoAmount + " " + b.asset
        receiveSub = "You receive"
        rows.push({
          label: "You pay",
          value: formatNGN(b.fiatAmount),
        })
        rows.push({
          label: "Rate",
          value: "1 " + b.asset + " = " + formatNGN(b.fxRate),
        })
        rows.push({
          label: "Fee",
          value: formatNGN(b.processingFeeAmount),
        })
        totalLabel = "Total charged"
        totalValue = formatNGN(b.totalFiat)
      } else if (outcome.txType === "sell") {
        // outcome.txType === 'sell' guarantees the server sent SellProposalConfirmation (schema-validated at ingress)
        const s = c as SellProposalConfirmation
        receiveAmt = s.fiatCurrency + " " + s.netFiatAmount
        receiveSub = "You receive"
        rows.push({
          label: "You sell",
          value: s.cryptoAmount + " " + s.asset,
        })
        rows.push({
          label: "Rate",
          value: "1 " + s.asset + " = " + s.fiatCurrency + " " + s.fxRate,
        })
        rows.push({
          label: "Fee",
          value: s.fiatCurrency + " " + s.processingFeeAmount,
        })
        if (s.beneficiaryLabel) {
          rows.push({ label: "To", value: s.beneficiaryLabel })
        }
        totalLabel = "Net payout"
        totalValue = s.fiatCurrency + " " + s.netFiatAmount
      } else if (outcome.txType === "send") {
        // outcome.txType === 'send' guarantees the server sent SendProposalConfirmation (schema-validated at ingress)
        const sn = c as SendProposalConfirmation
        receiveAmt = sn.cryptoAmount + " " + sn.asset
        receiveSub = "Amount sent"
        rows.push({ label: "To", value: sn.toAddressMasked })
        if (sn.beneficiaryLabel) {
          rows.push({ label: "Beneficiary", value: sn.beneficiaryLabel })
        }
        rows.push({ label: "Network", value: sn.network })
        rows.push({
          label: "Network fee",
          value: sn.networkFeeCrypto + " " + sn.asset,
        })
        totalLabel = "Total debit"
        totalValue = sn.totalDebit + " " + sn.asset
      }

      messages.push({
        id: makeId(),
        role: "assistant",
        kind: "quote",
        // send is a valid ChatAction; buy and sell are also valid
        action: outcome.txType as ChatAction,
        receiveAmt,
        receiveSub,
        rows,
        totalLabel,
        totalValue,
        lockSeconds,
        // ISO expiry drives the live quote countdown (and "expired" state on reload).
        expiresAt: c.expiresAt,
      })
    }

    proposalId = outcome.proposalId
  } else if (outcome.kind === "needs_kyc") {
    messages.push({
      id: makeId(),
      role: "assistant",
      kind: "text",
      text: "You need to complete verification first.",
    })
  } else if (outcome.kind === "needs_beneficiary") {
    // Inline add/select-beneficiary card; on resolve the store re-asks the
    // agent with the chosen beneficiaryId so the proposal can be created.
    messages.push({
      id: makeId(),
      role: "assistant",
      kind: "needs_beneficiary",
      beneficiaryType: outcome.beneficiaryType,
    })
  } else if (outcome.kind === "balance") {
    // Use the outcome's fiatCurrency rather than hardcoding NGN, so the card
    // renders correctly if a non-NGN currency is ever live (CLAUDE.md §3.6).
    const fiatCcy = outcome.fiatCurrency
    messages.push({
      id: makeId(),
      role: "assistant",
      kind: "balance",
      total: outcome.totalFiatValue
        ? "≈ " + fiatCcy + " " + outcome.totalFiatValue
        : "—",
      assets: outcome.balances.map((b) => ({
        sym: b.asset,
        name: ASSET_NAMES[b.asset] ?? b.asset,
        amount: `${b.amount} ${b.asset}`,
        value: b.fiatValue ? fiatCcy + " " + b.fiatValue : "—",
        tint: ASSET_TINTS[b.asset] ?? ASSET_TINTS.NGN,
      })),
    })
  } else if (outcome.kind === "not_supported") {
    messages.push({
      id: makeId(),
      role: "assistant",
      kind: "text",
      text: "That's not supported yet.",
    })
  } else if (outcome.kind === "currency_not_live") {
    messages.push({
      id: makeId(),
      role: "assistant",
      kind: "text",
      text: `We settle in NGN for now — ${outcome.currency} isn't live yet. Want to continue in NGN?`,
    })
  } else if (outcome.kind === "transactions") {
    messages.push({
      id: makeId(),
      role: "assistant",
      kind: "transactions",
      windowLabel: outcome.window.label,
      rows: outcome.items.map((it) => ({
        id: it.id,
        type: it.type,
        status: it.status,
        direction: it.direction,
        amount: `${it.direction === "in" ? "+" : "-"}${it.cryptoAmount ?? it.fiatAmount ?? ""}`,
        sub: it.createdAt.slice(0, 10),
      })),
      totalCount: outcome.totalCount,
      truncated: outcome.truncated,
      downloadUrl: outcome.downloadUrl,
    })
  }

  return { messages, proposalId }
}
