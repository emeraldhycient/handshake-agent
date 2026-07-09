/**
 * Query key factory — all TanStack Query keys in one place.
 *
 * Each key is a readonly tuple so consumers get stable references and
 * `invalidateQueries` can match precisely by prefix.
 */
export const qk = {
  config: ["config"] as const,
  balances: ["balances"] as const,
  walletAssets: ["walletAssets"] as const,
  activity: ["activity"] as const,
  deposit: ["deposit"] as const,
  events: ["events"] as const,
  notifications: ["notifications"] as const,
  searchCatalog: ["searchCatalog"] as const,
  auth: ["auth"] as const,
  me: ["auth", "me"] as const,
  profile: ["auth", "profile"] as const,
  profileSessions: ["auth", "profileSessions"] as const,
  pats: ["auth", "pats"] as const,
  transactionStatus: (id: string) => ["transaction", id, "status"] as const,
  transactionDetail: (id: string) => ["transaction", id, "detail"] as const,
  chatHistory: ["chatHistory"] as const,
  beneficiaries: (type: "bank_account" | "crypto_address") =>
    ["beneficiaries", type] as const,
  banks: (country: string) => ["banks", country] as const,
} as const
