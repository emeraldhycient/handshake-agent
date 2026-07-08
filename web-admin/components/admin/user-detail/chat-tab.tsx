// Design-mock conversation transcript (read-only; the real chat log is a later read).
const CHAT: readonly {
  text: string
  justify: "flex-start" | "flex-end"
  bg: string
  fg: string
  intent?: string
  proposal?: string
}[] = [
  {
    text: "I want to buy 100 USDT",
    justify: "flex-end",
    bg: "#1a4536",
    fg: "#fff",
  },
  {
    text: "Sure — 100 USDT at ₦1,064.69 = ₦106,469. Fee ₦1,178. Confirm with your PIN?",
    justify: "flex-start",
    bg: "var(--card2)",
    fg: "var(--ink)",
    intent: "crypto.buy",
    proposal: "proposal #p_8841",
  },
  { text: "Confirmed ✅", justify: "flex-end", bg: "#1a4536", fg: "#fff" },
  {
    text: "Done! 100 USDT is in your wallet. [receipt link redacted]",
    justify: "flex-start",
    bg: "var(--card2)",
    fg: "var(--ink)",
  },
]

/** The Chat-history tab — a read-only, secrets-redacted transcript (WhatsApp + web). */
export function ChatTab() {
  return (
    <div className="max-w-[720px] rounded-2xl border border-line bg-card p-5">
      <div className="mb-4 flex items-center gap-[9px] text-xs text-ink3">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="currentColor" strokeWidth="1.6" />
          <rect
            x="5"
            y="11"
            width="14"
            height="9"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </svg>
        Read-only transcript · secrets redacted · WhatsApp + web
      </div>
      {CHAT.map((m, i) => (
        <div key={i} className="mb-3 flex" style={{ justifyContent: m.justify }}>
          <div className="max-w-[75%]">
            <div
              className="rounded-[14px] p-[10px_13px] text-[13px] leading-[1.45]"
              style={{ background: m.bg, color: m.fg }}
            >
              {m.text}
            </div>
            {m.intent && (
              <div className="mt-[5px] inline-flex items-center gap-1.5 rounded-full bg-sif px-[9px] py-[3px] text-[10.5px] font-bold text-tif">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                </svg>
                intent: {m.intent} → {m.proposal}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
