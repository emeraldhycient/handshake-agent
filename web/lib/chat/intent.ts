import type { ChatAction } from "@/lib/schemas"

/**
 * Coarse NLU stub — ports the prototype's `parse()` method verbatim
 * (docs/design/_ref/handshake-prototype.html lines 1069–1078).
 *
 * Order is intentional: balance is checked BEFORE swap so "cash out" phrases
 * cannot be shadowed, and "my wallet" triggers balance before the swap branch.
 */
export function parseIntent(text: string): ChatAction | null {
  const t = (text || "").toLowerCase()
  if (/(buy|purchase|invest|get usdt|get some usdt|save in)/.test(t))
    return "buy"
  if (/(send|transfer|pay )/.test(t)) return "send"
  if (/(receive|deposit|my address|fund my)/.test(t)) return "receive"
  if (/(ticket|event|concert|show)/.test(t)) return "ticket"
  if (/(balance|how much|holdings|my wallet)/.test(t)) return "balance"
  if (/(swap|convert|exchange|cash out)/.test(t)) return "swap"
  return null
}
