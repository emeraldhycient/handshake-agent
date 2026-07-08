import { describe, expect, it } from "vitest"
import type { AdminLedgerEntry } from "@handshake-agent/contracts"

import { integrityPill, toRows } from "./rows"

function entry(
  over: Partial<AdminLedgerEntry> & Pick<AdminLedgerEntry, "id">
): AdminLedgerEntry {
  return {
    sequence: 1,
    accountType: "user_wallet",
    accountId: "acct-1",
    currency: "NGN",
    direction: "credit",
    amount: "1000.00",
    balanceAfter: "1000.00",
    transactionId: "tx-9",
    postedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  }
}

describe("toRows", () => {
  it("projects a credit entry, linking the source to its tx-detail route", () => {
    const [row] = toRows([entry({ id: "e-1" })])
    expect(row.seq).toBe("1")
    expect(row.acct).toBe("user_wallet:acct-1:NGN")
    expect(row.dir).toBe("CREDIT")
    expect(row.dirDanger).toBe(false)
    expect(row.src).toBe("tx-9")
    expect(row.href).toBe("/transactions/tx-9")
  })
  it("flags a debit as danger", () => {
    const [row] = toRows([entry({ id: "e-2", direction: "debit" })])
    expect(row.dir).toBe("DEBIT")
    expect(row.dirDanger).toBe(true)
  })
})

describe("integrityPill", () => {
  it("reports OK", () => {
    expect(
      integrityPill({ ok: true, accountsChecked: 12, brokenAccount: null })
    ).toEqual({
      broken: false,
      label: "Sequence integrity OK",
    })
  })
  it("reports a broken sequence with the account", () => {
    expect(
      integrityPill({
        ok: false,
        accountsChecked: 12,
        brokenAccount: "user_wallet:x:NGN",
      })
    ).toEqual({
      broken: true,
      label: "Sequence gap: user_wallet:x:NGN",
    })
  })
  it("shows a neutral checking label while undefined", () => {
    expect(integrityPill(undefined)).toEqual({
      broken: false,
      label: "Checking integrity…",
    })
  })
})
