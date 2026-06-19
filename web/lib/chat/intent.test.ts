import { describe, expect, it } from "vitest"
import { parseIntent } from "./intent"

const cases: [string, ReturnType<typeof parseIntent>][] = [
  ["Buy ₦50,000 of USDT", "buy"],
  ["I want to purchase usdt", "buy"],
  ["invest in crypto", "buy"],
  ["send 25 usdt", "send"],
  ["transfer to my friend", "send"],
  ["pay someone", "send"],
  ["show my deposit address", "receive"],
  ["fund my wallet", "receive"],
  ["get me a ticket", "ticket"],
  ["any concert?", "ticket"],
  ["event near me", "ticket"],
  ["what's my balance", "balance"],
  ["how much do I have", "balance"],
  ["my wallet", "balance"],
  ["swap to naira", "swap"],
  ["convert usdt", "swap"],
  ["cash out", "swap"],
  // Case-insensitivity proven across branches (input is lowercased first).
  ["SEND 10 USDT", "send"],
  ["CONVERT to NGN", "swap"],
  ["My Wallet", "balance"],
  // Documented prototype quirk: "show" lives in the ticket branch (pos 4),
  // checked before balance (pos 5), so "show my balance" resolves to ticket.
  ["show my balance", "ticket"],
  ["hello there", null],
  ["", null],
]

describe("parseIntent", () => {
  it.each(cases)("%s -> %s", (input, expected) =>
    expect(parseIntent(input)).toBe(expected)
  )
})
