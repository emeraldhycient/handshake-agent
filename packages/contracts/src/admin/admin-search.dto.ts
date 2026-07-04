import { z } from "zod";

// Admin global search (go-readiness #14) — the ⌘K header search across live entity
// data (users, transactions) in addition to nav pages. READ-ONLY: every result is
// an in-app href the palette navigates to; nothing here moves money (§3.1). PII is
// minimised — labels use displayName/email local-part, never a raw identifier (§3.4).

export const AdminSearchQuerySchema = z.object({
  q: z.string(),
});
export type AdminSearchQuery = z.infer<typeof AdminSearchQuerySchema>;

/** One search hit: what kind of entity, the in-app href, and its display lines. */
export const AdminSearchResultSchema = z.object({
  kind: z.enum(["user", "transaction"]),
  href: z.string(),
  label: z.string(),
  sublabel: z.string(),
});
export type AdminSearchResult = z.infer<typeof AdminSearchResultSchema>;

export const AdminSearchResponseSchema = z.object({
  results: z.array(AdminSearchResultSchema),
});
export type AdminSearchResponse = z.infer<typeof AdminSearchResponseSchema>;
