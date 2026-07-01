/**
 * Block-explorer URL builders, keyed by network.
 *
 * Data-driven so new chains are a one-line addition (e.g. an EVM explorer
 * `tx/<hash>` path) with zero changes to callers. The transaction-detail modal
 * uses `explorerTxUrl` to turn an on-chain tx hash into a clickable link; a null
 * result means the network has no known explorer, so the caller renders plain
 * copyable text instead of a link.
 */

/** Builds the explorer URL for a confirmed transaction on a given network. */
type ExplorerTxUrlBuilder = (txHash: string) => string

/**
 * Network → explorer-link builder. Keys are the lower-cased `network` value the
 * detail API returns (e.g. "tron"). Add a chain by registering one entry.
 */
const EXPLORER_TX_URL: Record<string, ExplorerTxUrlBuilder> = {
  tron: (txHash) => `https://tronscan.org/#/transaction/${txHash}`,
}

/**
 * Resolve the block-explorer URL for `txHash` on `network`, or `null` when the
 * network is unknown or the hash is empty (caller then shows plain text, no link).
 * The hash is URL-encoded so it is safe to interpolate into the path.
 */
export function explorerTxUrl(network: string, txHash: string): string | null {
  if (!txHash) return null
  const build = EXPLORER_TX_URL[network.toLowerCase()]
  return build ? build(encodeURIComponent(txHash)) : null
}
