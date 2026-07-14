import { describe, expect, it } from "vitest"
import type {
  AgentTurnOutcome,
  BuyProposalConfirmation,
  SwapProposalConfirmation,
} from "@handshake-agent/contracts"
import { mapOutcomeToMessages } from "./agent-outcome"

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
  it("maps a transactions outcome carrying the frozen window + pagination", () => {
    const outcome: AgentTurnOutcome = {
      kind: "transactions",
      window: {
        from: "2026-06-15T00:00:00.000Z",
        to: "2026-06-29T10:00:00.000Z",
        label: "Last 2 weeks",
      },
      items: [
        {
          id: "t1",
          type: "buy",
          status: "completed",
          direction: "in",
          cryptoAmount: "29.97 USDT",
          createdAt: "2026-06-20T10:00:00.000Z",
        },
      ],
      totalCount: 12,
      truncated: true,
      hasMore: true,
      nextCursor: "CURSOR1",
      txType: "all",
      downloadUrl:
        "https://api.example.com/transactions/statement/download?token=tok",
    }
    const { messages } = mapOutcomeToMessages(outcome, makeIder())
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      kind: "transactions",
      windowLabel: "Last 2 weeks",
      from: "2026-06-15T00:00:00.000Z",
      to: "2026-06-29T10:00:00.000Z",
      txType: "all",
      hasMore: true,
      nextCursor: "CURSOR1",
      rows: [{ id: "t1", amount: "+29.97 USDT", sub: "2026-06-20" }],
    })
  })

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

  it("maps a receive outcome with no min/eta to EMPTY chip values (never fabricates)", () => {
    // Finding #9: the backend does not yet populate minAmount/etaText, so the
    // mapper must NOT invent "—" / "~30 min" (a fabricated, wrong-for-TRON ETA
    // that disagrees with the wallet-page placeholder). Empty string → the card
    // hides the chip rather than showing a made-up number.
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
      minDeposit: "",
      creditedEta: "",
    })
  })

  it("maps a receive outcome carrying real min/eta through unchanged", () => {
    const outcome: AgentTurnOutcome = {
      kind: "receive",
      deposit: {
        asset: "USDT",
        network: "TRON",
        address: "TXabc",
        minAmount: "10",
        etaText: "~2 min",
      },
    }
    const { messages } = mapOutcomeToMessages(outcome, makeIder())
    expect(messages[0]).toMatchObject({
      minDeposit: "10",
      creditedEta: "~2 min",
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
      rows: [
        { label: "You pay", value: "₦50,000.00" },
        { label: "Rate", value: "1 USDT = ₦1,600.00" },
        { label: "Fee", value: "₦250.00" },
      ],
      totalLabel: "Total charged",
      totalValue: "₦50,250.00",
    })
  })

  it("buy quote rows drive the symbol from the confirmation's fiatCurrency, never a hardcoded ₦", () => {
    // §3.1 confirmation integrity: a GHS-settled buy must render GH₵ on every
    // fiat row — the sell branch already keys off fiatCurrency; buy must too.
    const outcome: AgentTurnOutcome = {
      kind: "proposal",
      txType: "buy",
      proposalId: buyConfirmation.proposalId,
      confirmation: { ...buyConfirmation, fiatCurrency: "GHS" },
    }
    const { messages } = mapOutcomeToMessages(outcome, makeIder())
    expect(messages[0]).toMatchObject({
      kind: "quote",
      action: "buy",
      rows: [
        { label: "You pay", value: "GH₵50,000.00" },
        { label: "Rate", value: "1 USDT = GH₵1,600.00" },
        { label: "Fee", value: "GH₵250.00" },
      ],
      totalValue: "GH₵50,250.00",
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
    // Every fiat field renders through formatFiat — the ₦ symbol + grouped
    // thousands, never the raw ISO code (mirrors the buy branch).
    expect(messages[0]).toMatchObject({
      kind: "quote",
      action: "sell",
      receiveAmt: "₦15,800.00",
      rows: [
        { label: "You sell", value: "10 USDT" },
        { label: "Rate", value: "1 USDT = ₦1,600.00" },
        { label: "Fee", value: "₦100.00" },
      ],
      totalLabel: "Net payout",
      totalValue: "₦15,800.00",
    })
  })

  it("maps an on-chain send proposal to a quote card with the masked address + fee row (unchanged)", () => {
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
    expect(messages[0]).toMatchObject({
      kind: "quote",
      action: "send",
      rows: [
        { label: "To", value: "TX1234...abcd" },
        { label: "Network", value: "TRON" },
        { label: "Network fee", value: "1 USDT" },
      ],
      totalLabel: "Total debit",
      totalValue: "6 USDT",
    })
  })

  it("maps an internal-transfer send proposal to a quote card showing the recipient name + @handle and an instant/no-fee row (never a masked address or a '0 USDT' fee line)", () => {
    const outcome: AgentTurnOutcome = {
      kind: "proposal",
      txType: "send",
      proposalId: "55555555-5555-5555-5555-555555555555",
      confirmation: {
        proposalId: "55555555-5555-5555-5555-555555555555",
        asset: "USDT",
        cryptoAmount: "10",
        network: "TRON",
        networkFeeCrypto: "0",
        totalDebit: "10",
        recipientDisplayName: "Ada T.",
        recipientHandle: "adat",
        instant: true,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    }
    const { messages, proposalId } = mapOutcomeToMessages(outcome, makeIder())
    expect(proposalId).toBe("55555555-5555-5555-5555-555555555555")
    expect(messages[0]).toMatchObject({
      kind: "quote",
      action: "send",
      rows: [
        { label: "To", value: "Ada T. · @adat" },
        { label: "Delivery", value: "Instant · No network fee" },
      ],
      totalLabel: "Total debit",
      totalValue: "10 USDT",
    })
    const row = (messages[0] as { rows: Array<{ label: string }> }).rows.find(
      (r) => r.label === "Network fee"
    )
    expect(row).toBeUndefined()
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

  it("maps a balance snapshot to a formatted balance card (₦ symbol + grouping, never the ISO code)", () => {
    const outcome: AgentTurnOutcome = {
      kind: "balance",
      fiatCurrency: "NGN",
      totalFiatValue: "63972.88",
      balances: [
        {
          asset: "USDT",
          network: "TRON",
          amount: "47.245072",
          fiatValue: "63972.88",
        },
        // An unpriced asset (no fiatValue) must render an em-dash, not "NGN ".
        { asset: "TRX", network: "TRON", amount: "2005.5" },
      ],
    }
    const { messages } = mapOutcomeToMessages(outcome, makeIder())
    expect(messages[0]).toMatchObject({
      kind: "balance",
      total: "≈ ₦63,972.88",
      assets: [
        { sym: "USDT", amount: "47.245072 USDT", value: "₦63,972.88" },
        { sym: "TRX", amount: "2005.5 TRX", value: "—" },
      ],
    })
  })

  it("maps needs_kyc to a verification text", () => {
    const { messages } = mapOutcomeToMessages({ kind: "needs_kyc" }, makeIder())
    expect(messages[0].kind).toBe("text")
    if (messages[0].kind === "text") {
      expect(messages[0].text).toContain("verification")
    }
  })

  it("maps needs_beneficiary (bank_account) to a needs_beneficiary card", () => {
    // These two were legacy "text" assertions guarded by an if-branch that
    // never ran (the mapper emits a needs_beneficiary card, not text) — they
    // now assert the real card shape.
    const { messages, proposalId } = mapOutcomeToMessages(
      { kind: "needs_beneficiary", beneficiaryType: "bank_account" },
      makeIder()
    )
    expect(proposalId).toBeNull()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "assistant",
      kind: "needs_beneficiary",
      beneficiaryType: "bank_account",
    })
  })

  it("maps needs_beneficiary (crypto_address) to a needs_beneficiary card", () => {
    const { messages, proposalId } = mapOutcomeToMessages(
      { kind: "needs_beneficiary", beneficiaryType: "crypto_address" },
      makeIder()
    )
    expect(proposalId).toBeNull()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "assistant",
      kind: "needs_beneficiary",
      beneficiaryType: "crypto_address",
    })
  })

  it("passes the needs_beneficiary note through for targeted nickname-miss copy", () => {
    // When a recipientNickname resolves to ZERO saved beneficiaries the server
    // sends a targeted note — the card must receive it (not the generic copy).
    const note =
      "No saved beneficiary called 'mum'. Add one first, or pick from your saved list."
    const { messages } = mapOutcomeToMessages(
      { kind: "needs_beneficiary", beneficiaryType: "bank_account", note },
      makeIder()
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "assistant",
      kind: "needs_beneficiary",
      beneficiaryType: "bank_account",
      note,
    })
  })

  it("passes prefillAddress + allowRawSend through for a raw-send-eligible crypto outcome", () => {
    // A crypto send with an edge-parsed address in the user's message and no
    // saved beneficiary: the server marks the card raw-send-eligible so the
    // web UI can offer a send-to-address path alongside the saved list.
    const outcome: AgentTurnOutcome = {
      kind: "needs_beneficiary",
      beneficiaryType: "crypto_address",
      prefillAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      allowRawSend: true,
    }
    const { messages } = mapOutcomeToMessages(outcome, makeIder())
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "assistant",
      kind: "needs_beneficiary",
      beneficiaryType: "crypto_address",
      prefillAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      allowRawSend: true,
    })
  })

  it("omits prefillAddress/allowRawSend when the outcome doesn't carry them (backwards compatible)", () => {
    const { messages } = mapOutcomeToMessages(
      { kind: "needs_beneficiary", beneficiaryType: "bank_account" },
      makeIder()
    )
    expect(messages[0]).toMatchObject({ kind: "needs_beneficiary" })
    if (messages[0].kind === "needs_beneficiary") {
      expect(messages[0].prefillAddress).toBeUndefined()
      expect(messages[0].allowRawSend).toBeUndefined()
    }
  })

  it("maps choose_beneficiary to a picker card carrying nickname + candidates", () => {
    // SECURITY (§3.1): candidates carry only server-resolved beneficiary ids and
    // human-safe masked details — the mapper must pass them through verbatim and
    // never synthesize or expose a full destination.
    const outcome: AgentTurnOutcome = {
      kind: "choose_beneficiary",
      beneficiaryType: "bank_account",
      nickname: "mum",
      candidates: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          label: "Mum",
          detail: "Guaranty Trust Bank (GTBank) ••6789",
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          label: "Mum",
          detail: "Access Bank ••4321",
        },
      ],
    }
    const { messages, proposalId } = mapOutcomeToMessages(outcome, makeIder())
    expect(proposalId).toBeNull()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "assistant",
      kind: "choose_beneficiary",
      beneficiaryType: "bank_account",
      nickname: "mum",
      candidates: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          label: "Mum",
          detail: "Guaranty Trust Bank (GTBank) ••6789",
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          label: "Mum",
          detail: "Access Bank ••4321",
        },
      ],
    })
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

  it("builds the currency_not_live copy from the server's liveCurrencies (two live fiats)", () => {
    const { messages, proposalId } = mapOutcomeToMessages(
      {
        kind: "currency_not_live",
        currency: "RWF",
        liveCurrencies: ["NGN", "GHS"],
      },
      makeIder()
    )
    expect(proposalId).toBeNull()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "assistant",
      kind: "text",
      text: "We currently settle in NGN and GHS — RWF isn't live yet.",
    })
  })

  it("builds the currency_not_live copy for a single live fiat", () => {
    const { messages } = mapOutcomeToMessages(
      { kind: "currency_not_live", currency: "RWF", liveCurrencies: ["NGN"] },
      makeIder()
    )
    expect(messages[0]).toMatchObject({
      kind: "text",
      text: "We currently settle in NGN — RWF isn't live yet.",
    })
  })

  it("lists three or more live fiats with commas and a final 'and'", () => {
    const { messages } = mapOutcomeToMessages(
      {
        kind: "currency_not_live",
        currency: "RWF",
        liveCurrencies: ["NGN", "GHS", "KES"],
      },
      makeIder()
    )
    expect(messages[0]).toMatchObject({
      kind: "text",
      text: "We currently settle in NGN, GHS and KES — RWF isn't live yet.",
    })
  })

  it("falls back to the legacy NGN copy when liveCurrencies is absent (old history rows)", () => {
    const { messages, proposalId } = mapOutcomeToMessages(
      { kind: "currency_not_live", currency: "RWF" },
      makeIder()
    )
    expect(proposalId).toBeNull()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "assistant",
      kind: "text",
      text: "We settle in NGN for now — RWF isn't live yet. Want to continue in NGN?",
    })
  })

  it("falls back to the legacy copy when liveCurrencies is empty", () => {
    // An empty live set is a server misconfiguration — never render
    // "We currently settle in  — …".
    const { messages } = mapOutcomeToMessages(
      { kind: "currency_not_live", currency: "GHS", liveCurrencies: [] },
      makeIder()
    )
    expect(messages[0]).toMatchObject({
      kind: "text",
      text: "We settle in NGN for now — GHS isn't live yet. Want to continue in NGN?",
    })
  })
})
