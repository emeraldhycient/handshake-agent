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
import { formatFiat } from "@/lib/format"
import { ASSET_NAMES, ASSET_TINTS } from "@/lib/constants"
import { mapHistoryItemToRow } from "@/lib/api/mappers/history-row"

export interface MappedOutcome {
  /** Assistant messages to append for this turn. */
  messages: ChatMessage[]
  /** Proposal id to stash for the execute phase, or null for non-proposal turns. */
  proposalId: string | null
}

/**
 * Join fiat codes into prose: "NGN" / "NGN and GHS" / "NGN, GHS and KES".
 * Used by the `currency_not_live` copy so the live settlement set reads
 * naturally however many currencies the server reports.
 */
function joinCurrencyList(codes: string[]): string {
  if (codes.length === 1) return codes[0]
  return `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`
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
      // Finding #9: never fabricate min-deposit / credited-ETA. The backend does
      // not populate these yet, and the old "—" / "~30 min" fallbacks were both
      // fake AND inconsistent with the wallet-page placeholders ("1 USDT" /
      // "~1 min"). Pass real values through; emit "" when absent so the card can
      // hide the chip instead of showing an invented number. ~30 min is also
      // simply wrong for TRON (credits after ~1-3 min).
      minDeposit: d.minAmount ?? "",
      creditedEta: d.etaText ?? "",
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
        // Drive every fiat row from the confirmation's fiatCurrency (§3.1
        // confirmation integrity) — never a hardcoded ₦. Mirrors the sell branch.
        rows.push({
          label: "You pay",
          value: formatFiat(b.fiatAmount, b.fiatCurrency),
        })
        rows.push({
          label: "Rate",
          value: "1 " + b.asset + " = " + formatFiat(b.fxRate, b.fiatCurrency),
        })
        rows.push({
          label: "Fee",
          value: formatFiat(b.processingFeeAmount, b.fiatCurrency),
        })
        totalLabel = "Total charged"
        totalValue = formatFiat(b.totalFiat, b.fiatCurrency)
      } else if (outcome.txType === "sell") {
        // outcome.txType === 'sell' guarantees the server sent SellProposalConfirmation (schema-validated at ingress)
        const s = c as SellProposalConfirmation
        receiveAmt = formatFiat(s.netFiatAmount, s.fiatCurrency)
        receiveSub = "You receive"
        rows.push({
          label: "You sell",
          value: s.cryptoAmount + " " + s.asset,
        })
        rows.push({
          label: "Rate",
          value: "1 " + s.asset + " = " + formatFiat(s.fxRate, s.fiatCurrency),
        })
        rows.push({
          label: "Fee",
          value: formatFiat(s.processingFeeAmount, s.fiatCurrency),
        })
        if (s.beneficiaryLabel) {
          rows.push({ label: "To", value: s.beneficiaryLabel })
        }
        totalLabel = "Net payout"
        totalValue = formatFiat(s.netFiatAmount, s.fiatCurrency)
      } else if (outcome.txType === "send") {
        // outcome.txType === 'send' guarantees the server sent SendProposalConfirmation (schema-validated at ingress)
        const sn = c as SendProposalConfirmation
        receiveAmt = sn.cryptoAmount + " " + sn.asset
        receiveSub = "Amount sent"
        // An internal (PayID) transfer settles instantly in-custody: no
        // on-chain address to mask and no network fee. It is legible via the
        // recipient's display name + handle instead. `instant` is the
        // authoritative server signal; the absent-address fallback covers any
        // older persisted row that predates the field (defensive, never the
        // other way around — an on-chain send always carries toAddressMasked).
        const isInternalTransfer =
          sn.instant === true ||
          (!sn.toAddressMasked &&
            !!(sn.recipientHandle || sn.recipientDisplayName))

        if (isInternalTransfer) {
          const name = sn.recipientDisplayName
          const handle = sn.recipientHandle ? `@${sn.recipientHandle}` : ""
          rows.push({
            label: "To",
            value: [name, handle].filter(Boolean).join(" · "),
          })
          if (sn.beneficiaryLabel) {
            rows.push({ label: "Beneficiary", value: sn.beneficiaryLabel })
          }
          // Never a literal "0 USDT" fee row — an instant ledger transfer has
          // no network fee to itemize, so state that directly instead.
          rows.push({ label: "Delivery", value: "Instant · No network fee" })
        } else {
          rows.push({ label: "To", value: sn.toAddressMasked ?? "" })
          if (sn.beneficiaryLabel) {
            rows.push({ label: "Beneficiary", value: sn.beneficiaryLabel })
          }
          rows.push({ label: "Network", value: sn.network })
          rows.push({
            label: "Network fee",
            value: sn.networkFeeCrypto + " " + sn.asset,
          })
        }
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
    // `note` carries the server's targeted copy when a recipient nickname
    // matched nothing (e.g. "No saved beneficiary called 'mum'…").
    messages.push({
      id: makeId(),
      role: "assistant",
      kind: "needs_beneficiary",
      beneficiaryType: outcome.beneficiaryType,
      note: outcome.note,
      // Edge-parsed address + raw-send eligibility (crypto only) — pre-fills
      // and unlocks the send-mode form on the card (§3.1: still user-edited).
      prefillAddress: outcome.prefillAddress,
      allowRawSend: outcome.allowRawSend,
    })
  } else if (outcome.kind === "choose_beneficiary") {
    // Nickname matched MORE THAN ONE saved beneficiary — render the pick-one
    // card. Candidates are passed through verbatim: `id` is a server-resolved
    // lookup key and `detail` is already masked server-side (§3.1) — the mapper
    // must never synthesize or unmask a destination.
    messages.push({
      id: makeId(),
      role: "assistant",
      kind: "choose_beneficiary",
      beneficiaryType: outcome.beneficiaryType,
      nickname: outcome.nickname,
      candidates: outcome.candidates.map((c) => ({
        id: c.id,
        label: c.label,
        detail: c.detail,
      })),
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
        ? "≈ " + formatFiat(outcome.totalFiatValue, fiatCcy)
        : "—",
      assets: outcome.balances.map((b) => ({
        sym: b.asset,
        name: ASSET_NAMES[b.asset] ?? b.asset,
        amount: `${b.amount} ${b.asset}`,
        value: b.fiatValue ? formatFiat(b.fiatValue, fiatCcy) : "—",
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
    // The server sends the catalog-driven live settlement set (liveCurrencies)
    // so this copy names what CAN settle today. Older persisted history rows
    // pre-date the field — fall back to the legacy launch copy for those.
    const live = outcome.liveCurrencies ?? []
    const text =
      live.length > 0
        ? `We currently settle in ${joinCurrencyList(live)} — ${outcome.currency} isn't live yet.`
        : `We settle in NGN for now — ${outcome.currency} isn't live yet. Want to continue in NGN?`
    messages.push({
      id: makeId(),
      role: "assistant",
      kind: "text",
      text,
    })
  } else if (outcome.kind === "transactions") {
    messages.push({
      id: makeId(),
      role: "assistant",
      kind: "transactions",
      windowLabel: outcome.window.label,
      rows: outcome.items.map(mapHistoryItemToRow),
      totalCount: outcome.totalCount,
      truncated: outcome.truncated,
      downloadUrl: outcome.downloadUrl,
      // Frozen absolute window + filter + cursor so "Show more" pages the same window.
      from: outcome.window.from,
      to: outcome.window.to,
      txType: outcome.txType,
      hasMore: outcome.hasMore,
      nextCursor: outcome.nextCursor,
    })
  }

  return { messages, proposalId }
}
