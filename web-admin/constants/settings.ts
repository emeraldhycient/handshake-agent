/**
 * Settings-console constants (design §6.30). The shared 5-column grid template + the
 * Edit / Locked icon paths. Kept once so the header row and every body row line up
 * pixel-for-pixel with the markup.
 */

// Design §6.30 table grid — Key / Effective value / Source / Description / Edit.
export const SETTINGS_GRID = "grid-cols-[1.5fr_1fr_0.7fr_1.5fr_0.9fr]"

// Edit-pencil path used in the active Edit pill (DB-layer keys).
export const PENCIL_PATH =
  "M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"

// Lock path used in the Edit column for read-only baseline keys.
export const LOCK_PATH = "M6 10V7a6 6 0 1 1 12 0v3M5 10h14v10H5V10Z"
