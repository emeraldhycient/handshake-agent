/**
 * Query key factory — all TanStack Query keys in one place.
 *
 * Each key is a readonly tuple so consumers get stable references and
 * `invalidateQueries` can match precisely by prefix.
 */
export const qk = {
  balances: ["balances"] as const,
  walletAssets: ["walletAssets"] as const,
  activity: ["activity"] as const,
  deposit: ["deposit"] as const,
  events: ["events"] as const,
  notifications: ["notifications"] as const,
  searchCatalog: ["searchCatalog"] as const,
} as const
