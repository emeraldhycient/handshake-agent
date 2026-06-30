import { describe, expect, it } from "vitest"
import type {
  AgentTurnOutcome,
  BuyProposalConfirmation,
  SwapProposalConfirmation,
} from "@handshake-agent/contracts"
import { mapOutcomeToMessages, LIVE_SETTLEMENT_FIAT } from "./agent-outcome"

/** Deterministic id generator for assertions. */
function makeIder() {
  let i = 0
  return () => `m${++i}`
}

const buyConfirmation: BuyProposalConfirmation = {
  proposalId: "11111111-1111-1111-1111-111111111111",
  asset: "USDT",
  fiatAmount: "50000",
  fiatCurrency: "NGN",
  cryptoAmount: "31.25",
  fxRate: "1600",
  spreadBps: 150,
  processingFeeBps: 50,
  processingFeeAmount: "250",
  totalFiat: "50250",
  expiresAt: new Date(Date.now() + 60000).toISOString(),
}

describe("mapOutcomeToMessages", () => {
  it("maps a clarification to a single assistant text message", () => {
    const { messages, proposalId } = mapOutcomeToMessages(
      { kind: "clarification", text: "Please clarify?" },
      makeIder()
    )
    expect(proposalId).toBeNull()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "assistant",
      kind: "text",
      text: "Please clarify?",
    })
  })

  it("maps a receive outcome to a receive card with fallbacks", () => {
    const outcome: AgentTurnOutcome = {
      kind: "receive",
      deposit: { asset: "USDT", network: "TRON", address: "TXabc" },
    }
    const { messages } = mapOutcomeToMessages(outcome, makeIder())
    expect(messages[0]).toMatchObject({
      kind: "receive",
      asset: "USDT",
      network: "TRON",
      address: "TXabc",
      minDeposit: "—",
      creditedEta: "~30 min",
    })
  })

  it("maps a buy proposal to a quote card and returns its proposalId", () => {
    const outcome: AgentTurnOutcome = {
      kind: "proposal",
      txType: "buy",
      proposalId: buyConfirmation.proposalId,
      confirmation: buyConfirmation,
    }
    const { messages, proposalId } = mapOutcomeToMessages(outcome, makeIder())
    expect(proposalId).toBe(buyConfirmation.proposalId)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      kind: "quote",
      action: "buy",
      receiveAmt: "31.25 USDT",
    })
  })

  it("maps a sell proposal to a quote card", () => {
    const outcome: AgentTurnOutcome = {
      kind: "proposal",
      txType: "sell",
      proposalId: "22222222-2222-2222-2222-222222222222",
      confirmation: {
        proposalId: "22222222-2222-2222-2222-222222222222",
        asset: "USDT",
        cryptoAmount: "10",
        fiatCurrency: "NGN",
        netFiatAmount: "15800",
        fxRate: "1600",
        processingFeeAmount: "100",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    }
    const { messages, proposalId } = mapOutcomeToMessages(outcome, makeIder())
    expect(proposalId).toBe("22222222-2222-2222-2222-222222222222")
    expect(messages[0]).toMatchObject({ kind: "quote", action: "sell" })
  })

  it("maps a send proposal to a quote card", () => {
    const outcome: AgentTurnOutcome = {
      kind: "proposal",
      txType: "send",
      proposalId: "33333333-3333-3333-3333-333333333333",
      confirmation: {
        proposalId: "33333333-3333-3333-3333-333333333333",
        asset: "USDT",
        cryptoAmount: "5",
        network: "TRON",
        networkFeeCrypto: "1",
        totalDebit: "6",
        toAddressMasked: "TX1234...abcd",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    }
    const { messages, proposalId } = mapOutcomeToMessages(outcome, makeIder())
    expect(proposalId).toBe("33333333-3333-3333-3333-333333333333")
    expect(messages[0]).toMatchObject({ kind: "quote", action: "send" })
  })

  it("maps a swap proposal to a swap card message and returns its proposalId", () => {
    const swapConfirmation: SwapProposalConfirmation = {
      proposalId: "44444444-4444-4444-4444-444444444444",
      fromAsset: "USDT",
      toAsset: "BTC",
      fromAmount: "100",
      toAmount: "0.00095",
      rate: "0.0000095",
      networkFee: "1",
      transactionFee: "0.5",
      estimatedArrivalSec: 120,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    }
    const outcome: AgentTurnOutcome = {
      kind: "proposal",
      txType: "swap",
      proposalId: swapConfirmation.proposalId,
      confirmation: swapConfirmation,
    }
    const { messages, proposalId } = mapOutcomeToMessages(outcome, makeIder())
    expect(proposalId).toBe(swapConfirmation.proposalId)
    expect(messages).toHaveLength(1)
    const msg = messages[0]
    expect(msg).toMatchObject({
      role: "assistant",
      kind: "swap",
      fromAsset: "USDT",
      toAsset: "BTC",
      fromAmount: "100",
      toAmount: "0.00095",
      rate: "0.0000095",
      networkFee: "1",
      transactionFee: "0.5",
      estimatedArrivalSec: 120,
    })
    // FX spread must never appear in the message
    expect((msg as Record<string, unknown>)["spreadBps"]).toBeUndefined()
  })

  it("maps needs_kyc to a verification text", () => {
    const { messages } = mapOutcomeToMessages({ kind: "needs_kyc" }, makeIder())
    expect(messages[0].kind).toBe("text")
    if (messages[0].kind === "text") {
      expect(messages[0].text).toContain("verification")
    }
  })

  it("maps needs_beneficiary (bank_account) to a bank-account text", () => {
    const { messages } = mapOutcomeToMessages(
      { kind: "needs_beneficiary", beneficiaryType: "bank_account" },
      makeIder()
    )
    if (messages[0].kind === "text") {
      expect(messages[0].text).toContain("bank account")
    }
  })

  it("maps needs_beneficiary (crypto_address) to a crypto-address text", () => {
    const { messages } = mapOutcomeToMessages(
      { kind: "needs_beneficiary", beneficiaryType: "crypto_address" },
      makeIder()
    )
    if (messages[0].kind === "text") {
      expect(messages[0].text).toContain("crypto address")
    }
  })

  it("maps not_supported to a not-supported text", () => {
    const { messages } = mapOutcomeToMessages(
      { kind: "not_supported", action: "swap" },
      makeIder()
    )
    if (messages[0].kind === "text") {
      expect(messages[0].text).toContain("not supported")
    }
  })

  it("maps currency_not_live (RWF) to a friendly assistant text mentioning the currency", () => {
    const { messages, proposalId } = mapOutcomeToMessages(
      { kind: "currency_not_live", currency: "RWF" },
      makeIder()
    )
    expect(proposalId).toBeNull()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: "assistant", kind: "text" })
    if (messages[0].kind === "text") {
      expect(messages[0].text).toContain("RWF")
      expect(messages[0].text).toContain("NGN")
    }
  })

  it("maps currency_not_live (GHS) to a text that names GHS specifically", () => {
    const { messages } = mapOutcomeToMessages(
      { kind: "currency_not_live", currency: "GHS" },
      makeIder()
    )
    expect(messages).toHaveLength(1)
    if (messages[0].kind === "text") {
      expect(messages[0].text).toContain("GHS")
    }
  })

  it("sources the live settlement currency from LIVE_SETTLEMENT_FIAT, not a hardcoded literal (audit #28)", () => {
    // The live settlement fiat appears in the copy and comes from a single
    // named constant — so it cannot drift between the two mentions.
    expect(LIVE_SETTLEMENT_FIAT).toBe("NGN")
    const { messages } = mapOutcomeToMessages(
      { kind: "currency_not_live", currency: "GHS" },
      makeIder()
    )
    if (messages[0].kind === "text") {
      // Both occurrences of the live fiat in the sentence are the constant.
      const occurrences = (
        messages[0].text.match(new RegExp(LIVE_SETTLEMENT_FIAT, "g")) ?? []
      ).length
      expect(occurrences).toBe(2)
    }
  })
})
