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
} as const
