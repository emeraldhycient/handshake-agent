/**
 * Asset-catalog constants (design §6.23). The 6-column grid template + the initial
 * last-sync caption (boot runs a sync automatically via CatalogSyncService).
 */

// Design §6.23 table grid — Asset / Chain / Decimals / Min-max / Contract / Live.
export const ASSETS_GRID = "grid-cols-[1.4fr_0.8fr_0.7fr_1fr_1.6fr_0.7fr]"

// The last-sync caption; advanced when a manual Blockradar re-sync completes.
export const INITIAL_LAST_SYNC = "on boot · from the live catalog"
