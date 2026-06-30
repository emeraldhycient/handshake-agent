/**
 * Prototype data literals — hex values are DATA (not theme tokens).
 * They are defined here in lib/ and passed via props / inline style.
 * Components must NOT contain hex literals directly (root CLAUDE.md §13.1).
 */

/** Asset background tint colours — dynamic data, applied via inline style */
export const ASSET_TINTS: Record<string, string> = {
  USDT: "#7fd1a8",
  BTC: "#f5c46b",
  NGN: "#cfe6d8",
}

/** Human-readable asset names, keyed by symbol. Falls back to the symbol itself. */
export const ASSET_NAMES: Record<string, string> = {
  USDT: "Tether USD",
  BTC: "Bitcoin",
  NGN: "Naira",
}

/** USDT deposit address shown in the receive / deposit flow */
export const DEPOSIT_ADDRESS = "TQn9Y2khEb7g5mZ8FjpRt1cWnH4dHkLm3vQ"

/** Supported UI languages (in display order) */
export const LANGUAGES = [
  "English",
  "Pidgin",
  "Hausa",
  "Yoruba",
  "Igbo",
] as const

/** Mobile greeting — shown as the initial assistant message in the chat thread */
export const GREETING_M =
  "Hi — I'm your Handshake Agent. Tell me what you'd like to do: buy or sell crypto, send money, or get an event ticket. You can write in English, Pidgin, Hausa, Yoruba or Igbo."

/**
 * Desktop greeting — shown in the desktop chat rail on first load.
 *
 * Personalizes with the signed-in user's first name when one is known (the
 * topbar uses the same profile name); falls back to a NAME-FREE generic
 * greeting otherwise. Never shows a hardcoded placeholder name.
 */
export function greetingDesktop(firstName?: string): string {
  const name = firstName?.trim()
  return name
    ? `Welcome back, ${name}. I'm right here whenever you want to move money or grab a ticket — just ask.`
    : "Welcome back! I'm right here whenever you want to move money or grab a ticket — just ask."
}

/**
 * Desktop greeting default — the name-free variant, used at store init before
 * the profile has loaded. Once the profile is available, the store swaps in the
 * personalized greeting via `setDesktopGreeting(firstName)`.
 */
export const GREETING_D = greetingDesktop()
