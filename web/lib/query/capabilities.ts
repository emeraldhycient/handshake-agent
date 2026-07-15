import { useConfig } from "./hooks"

/**
 * Effective service-capability flags from `/config`. Fail-closed: while the
 * config is loading or a flag is absent/false, the capability is treated as off
 * (matches the backend AssetRegistry, which fails closed on unknown keys).
 *
 * Drives which services the UI exposes — never hardcode the service list in
 * components.
 */
export function useCapabilities() {
  const { data } = useConfig()
  const caps = data?.capabilities ?? {}
  const has = (key: string) => caps[key] === true
  return {
    has,
    canSwap: has("crypto.swap"),
    canSell: has("crypto.sell"),
    canTickets: has("ticketing"),
  }
}
