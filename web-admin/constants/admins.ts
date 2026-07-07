/**
 * Admins & roles constants (design §6.15). The operator striped avatar and the
 * role-dot palette. NOTE: these carry raw hex verbatim from the design markup
 * (`logic.js` roleMeta / the avatar stripe) — pre-existing, moved as-is so the
 * decomposition is pixel-identical; tokenizing them is a separate design pass.
 */

/** Admin/operator striped avatar (§1.3) — brand-green diagonal stripes. */
export const AVATAR_STRIPE =
  "repeating-linear-gradient(45deg,#2a6f55 0 5px,#1a4536 5px 10px)"

/**
 * The design's role-dot palette (`roleMeta()`, logic.js 168-173). Roles arrive by
 * display name, not a fixed slug, so a role's dot colour is assigned by hashing its
 * name into this palette — deterministic per role, design-consistent tokens, and
 * stable across renders.
 */
export const ROLE_DOT_PALETTE: readonly string[] = [
  "var(--brand-amber)",
  "var(--tif)",
  "var(--tok)",
  "#8a4b8a",
  "#c07a2a",
  "var(--ink3)",
]
