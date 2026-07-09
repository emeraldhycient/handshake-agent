import { z } from "zod";

/**
 * Personal access tokens (PATs) — Wave C (go-live program).
 *
 * A PAT is a user-minted bearer credential for the machine/MCP surface. It is
 * READ + PROPOSE only by design: the scope enum below has no execute/authorize
 * member, so a PAT can never move money — PIN + step-up execution stays on the
 * web/WhatsApp surfaces (root CLAUDE.md §3.1/§3.5). The raw token is shown
 * exactly once at mint; the server stores only its SHA-256 hash (mirrors the
 * Session token-hashing pattern).
 */

/** Raw-token prefix — lets the guard cheaply distinguish PATs from session JWTs. */
export const PAT_TOKEN_PREFIX = "hsk_pat_" as const;

/**
 * The full scope set. `read` = read-only tools (balances, transactions,
 * beneficiaries, profile, quotes); `chat:propose` = run an agent turn that may
 * END at a proposal (never an execution — §3.1).
 */
export const PAT_SCOPES = ["read", "chat:propose"] as const;

export const PatScopeSchema = z.enum(PAT_SCOPES);
export type PatScope = z.infer<typeof PatScopeSchema>;

/**
 * Request DTO for POST /profile/tokens. Minting is a sensitive action: the
 * user's transaction PIN travels in-body and is verified server-side through
 * the lockout-protected PinService before any token is created.
 */
export const CreatePatRequestSchema = z.object({
  label: z.string().trim().min(1).max(80),
  /** Raw transaction PIN — verified server-side, never stored or logged. */
  pin: z.string().min(1),
  /** Defaults to read-only; callers must opt in to chat:propose explicitly. */
  scopes: z.array(PatScopeSchema).min(1).default(["read"]),
  /** Optional expiry horizon; omitted = non-expiring (revocable any time). */
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});
export type CreatePatRequest = z.infer<typeof CreatePatRequestSchema>;

/**
 * Response for POST /profile/tokens — the ONLY place the raw token ever
 * appears. It is not retrievable again; lists are masked (PatListItemSchema).
 */
export const CreatePatResponseSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  scopes: z.array(PatScopeSchema),
  /** The raw bearer token (`hsk_pat_…`) — shown once, never stored raw. */
  token: z.string().startsWith(PAT_TOKEN_PREFIX),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
});
export type CreatePatResponse = z.infer<typeof CreatePatResponseSchema>;

/** Masked list projection — id/label/scopes/timestamps only; never the token. */
export const PatListItemSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  scopes: z.array(PatScopeSchema),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
export type PatListItem = z.infer<typeof PatListItemSchema>;

export const PatListResponseSchema = z.object({
  tokens: z.array(PatListItemSchema),
});
export type PatListResponse = z.infer<typeof PatListResponseSchema>;
