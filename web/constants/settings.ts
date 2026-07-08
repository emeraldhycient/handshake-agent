import type { PatScope } from "@handshake-agent/contracts"

/**
 * User-facing copy + option lists for the Settings surface (profile edit,
 * change-PIN dialog, sessions, connected agents / MCP tokens).
 */

/** Copy for PIN verification failures, keyed by cause (see lib/settings/pin-error). */
export const PIN_ERROR_COPY = {
  wrongPin: "That PIN is incorrect. Check it and try again.",
  locked:
    "Your PIN is temporarily locked after too many failed attempts. Try again later.",
  generic: "Something went wrong. Please try again.",
} as const

/** Scope options for the create-token dialog — mirrors the contracts PAT_SCOPES. */
export const PAT_SCOPE_OPTIONS: ReadonlyArray<{
  scope: PatScope
  label: string
  description: string
}> = [
  {
    scope: "read",
    label: "Read account data",
    description: "Balances, transactions, beneficiaries and your profile",
  },
  {
    scope: "chat:propose",
    label: "Propose transactions via chat",
    description:
      "Chat with the agent to prepare transactions — never execute them",
  },
]

/** Expiry choices for a new token. `never` omits expiresInDays (revocable any time). */
export const PAT_EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never expires" },
] as const

/** Shown next to the raw token — it is retrievable exactly once (server stores a hash). */
export const TOKEN_SHOWN_ONCE_NOTE =
  "You will not see this token again. Copy it now and store it somewhere safe."

/** §3.1 in user words: agents read + prepare; execution stays PIN-confirmed in-app. */
export const MCP_CAPABILITY_NOTE =
  "Connected agents can read your balances, history and beneficiaries, and prepare transactions — but every execution must be confirmed with your PIN in this app."
