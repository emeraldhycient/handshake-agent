# Go-live program — consolidated design (2026-07-08)

Program spec for the 2026-07-08 enterprise-readiness pass. Sources: a 9-agent parallel audit
(security delta vs `docs/security-audit-2026-07-04.md`, mocked-services inventory, admin
functional audit, multi-currency gap analysis, and feature baselines). Each wave below is one
reviewable PR. Funds-safety invariants (root `CLAUDE.md` §3) are binding on every wave.

---

## Wave A — Security fixes + dead-guardrail repair (`fix/security-golive`)

**A1 (HIGH, new regression).** Flutterwave `verif-hash` — a *static shared secret* (v3 equality
check, not an HMAC) — is persisted verbatim into `webhook_events.headers` and `.signature` by the
webhook-queue feature and served to operators via `GET /admin/webhooks/:id`. Fix: a shared
`sanitizeWebhookHeaders` denylist (verif-hash, authorization, cookie, x-api-key) applied before
`WebhookIngestionService.ingest` persists anything; for Flutterwave store a SHA-256 digest of the
presented hash as `signature`, never the raw value. Ops must rotate `FLUTTERWAVE_WEBHOOK_SECRET`
after deploy (it has been stored in cleartext).

**A2 (MED).** `POST /chat/voice` `FileInterceptor('audio')` has no `limits` — multer buffers the
whole body into memory before the 15 MB check. Fix: pass `limits: { fileSize }` from
`media.voice.maxUploadBytes` so multer aborts mid-stream; map the multer error to 413.

**A3 (LOW).** Pin `algorithms: ['HS256']` in `TokenService.verifyAccessToken` and
`AdminTokenService.verify` (audit R3).

**A4 (MED).** Production boot guards (mirror existing `superRefine` guards in `env.schema.ts`):
reject boot when `NODE_ENV=production` and (a) `RESEND_API_KEY` is empty (mock email provider
logs OTPs — audit R5), (b) `FLUTTERWAVE_SCENARIO_KEY` is non-empty (sandbox-only header).

**A5 (CRITICAL guardrail).** `.dependency-cruiser.cjs` `exclude: generated/` removes the
generated Prisma client from the cruise, so every `^api/generated/prisma` rule is dead — the
§3.2 "agent never touches the DB" invariant is convention-only today (verified by probe). Fix:
`doNotFollow: node_modules|(^|/)generated/`, `exclude: (^|/)(dist|\.next|coverage)/`. Add the
missing documented rules: FE `hooks/constants/types` must not import `components/app`;
api `presentation` must not import `infrastructure`; `application/domain/agent` must not import
`api/src/core/prisma`; cross-app isolation (web ↛ web-admin ↛ web ↛ api). Land only rules that
run clean (fix any real violations they surface, or defer that rule with a note).

**Deferred to the enhancement plan (documented, not fixed here):** R1 refresh-token
localStorage → HttpOnly cookie; R2 step-up on beneficiary-add; R4 scrypt→argon2id PIN KDF;
maker-checker adoption for config writes; CI e2e lane (blocked on the two known-red suites).

## Wave B — Beneficiary nicknames (`feat/beneficiary-nicknames`)

`Beneficiary.label` (required, free-text) already exists end-to-end (web forms, WhatsApp Flow,
name-enquiry keeps the verified holder name separate). Missing is the resolve side:

1. **Contracts:** optional `recipientNickname` on `SendCryptoIntentSchema` and
   `SellCryptoIntentSchema` — a *lookup key*, never a destination (the schema comment forbidding
   address extraction stays). New `AgentTurnOutcome` kind `choose_beneficiary` carrying
   `candidates: [{id, label, maskedDetail}]` + the original intent context.
2. **Prompt rule** (`anthropic-llm.provider.ts`): extract the recipient's name/nickname when the
   user names one; NEVER extract addresses/account numbers.
3. **Resolver:** `IBeneficiaryRepository.findByLabel(userId, type, label)` — case-insensitive,
   soft-delete-excluding, returns all matches; `BeneficiaryService.resolveByNickname`.
4. **Routing** (web `WebChatService` sell+send branches; WhatsApp `ConversationService` parity):
   explicit `input.beneficiaryId` (user picked in the resolve loop) → else nickname resolution
   (single match: use; multi: `choose_beneficiary` outcome; none: `needs_beneficiary` with a
   targeted "nobody saved as X" note) → else default beneficiary → else `needs_beneficiary`.
   A nickname always beats the silent default.
5. **Web card** for `choose_beneficiary` reusing the existing `resolveBeneficiary` re-send loop;
   confirmation cards already render `beneficiaryLabel` + resolved holder name + masked
   destination, so the §3.1 confirm step catches a mis-saved nickname.
6. **WhatsApp:** seed the beneficiary Flow's `beneficiaries` list (the sender port already
   accepts `[{id,label}]`) so select-from-saved works in-thread.

Funds-safety: resolution yields only a beneficiaryId; proposal + engine re-validate ownership,
type, cooling-off, sanctions exactly as today. Conversational "save this address as mum" is out
of scope (enhancement plan).

## Wave C — User settings + PAT + MCP surface (`feat/settings-mcp`)

**API (identity/auth):**
- `POST /profile/pin/change` — body `{currentPin, newPin}`; verifies current PIN through the
  lockout-protected `PinService.verifyPin`, then `setPin`. 403 on lockout, 422 on policy.
- `PATCH /profile` — non-identity fields only: `phone`, `fiatCurrency` (must be an enabled fiat).
  KYC-owned fields (name, DOB, NIN/BVN) are immutable here by design (§3.4).
- `GET /profile/sessions` + `DELETE /profile/sessions/:id` — list/revoke own sessions (admin
  repo queries are the template, scoped to the current user; current session marked).

**Personal access tokens (new, for MCP):** `PersonalAccessToken` table mirroring the Session
hashing pattern — SHA-256 hash only, `label`, `scopes` (`read`, `chat:propose`), `lastUsedAt`,
optional `expiresAt`, revocable. `POST /profile/tokens` (requires the user's PIN in-body,
verified server-side — token minting is a sensitive action), `GET /profile/tokens` (masked),
`DELETE /profile/tokens/:id`. Raw token shown once, prefix `hsk_pat_`.

**MCP module (`api/src/modules/mcp/`):** Streamable-HTTP MCP server (stateless) at `POST /mcp`
using `@modelcontextprotocol/sdk`, authenticated ONLY by PAT bearer (never session JWTs). Tools
(all call existing application services through the module's application layer — the tool list
itself is the scope allowlist; no execute/authorize tool exists on this surface):
`get_balances`, `get_deposit_address`, `list_transactions`, `get_transaction`,
`list_beneficiaries`, `get_profile`, `get_capabilities`, `quote_buy`, `quote_sell`,
`send_chat_message` (runs the agent turn; on a proposal outcome returns the itemized parameters
+ proposalId + instruction to confirm in the web app), `list_pending_proposals` (new read).
§3.1/§3.5 preserved: MCP reads and proposes; PIN + step-up execution stays on web/WhatsApp.

**Web settings page:** keep the existing in-memory `settings` tab (consistent with sibling
pages). SettingsPanel becomes an orchestrator composing extracted sections
(`components/settings/*`): Profile (edit phone + display currency), Security (working Change-PIN
dialog; sessions list with revoke), Connected agents / MCP (PAT create-with-PIN dialog showing
the token once, PAT list/revoke, connection instructions with the MCP URL and Claude
setup steps), Language (existing), Limits (existing), Logout (existing).

## Wave D — Multi-currency + admin console fixes (`fix/multicurrency-admin`)

**Web (user app):**
- Buy proposal card + confirm sheet: `formatNGN` → `formatFiat(amount, fiatCurrency)` (§3.1
  confirmation-integrity fix; sell branch is the reference).
- `currency_not_live` copy: build "we settle in …" from `useConfig` enabled fiats; delete
  `LIVE_SETTLEMENT_FIAT`.
- Authenticated immediate-completion path: replace the demo `buildReceipt` fixture with a receipt
  built from the confirmed payload (kills the fake-₦-receipt latent path).
- Thread /config fiat symbols+decimals into chat-card formatting (FIAT_SYMBOLS stays as offline
  fallback); drop the fake "₦50,000 transaction" row + naira-pinned copy from the search fixture.

**web-admin + api:**
- Payout-queue approval gate: add `fiatCurrency` to the outbox projection + contract; replace the
  hardcoded `LARGE_PAYOUT_NGN_THRESHOLD` with a per-currency layered-config map
  (`treasury.largePayoutThresholds`), compared in the payout's own currency.
- Travel Rule: add `fiatCurrency` column to `TravelRuleData` (snapshot the quote/default fiat at
  capture), thread through port → contract → FE cell (compliance-record correctness).
- Treasury page: delete the local ₦-only formatter; render one float card per currency; FX
  position uses its own `fiatCurrency`.
- User-detail Limits tab: optional `?currency=` on the endpoint (default = defaultFiat) + a
  currency chip when the user has usage in more than one fiat.
- Custom-currency dead-end: accept `pricing.assets.<asset>.baseRates.<CODE>` (and limits keys)
  for runtime-added fiats by validating against the live CustomFiat store instead of the static
  KNOWN_FIAT_CURRENCIES list; pricing console offers custom codes in add-price options.
- Discovered-asset kill-switch: accept `catalog.assets.<sym>.enabled` for provider-discovered
  symbols (validate against the registry's discovered set).
- Ledger/metrics currency filters + FIAT_SYMBOLS: derive options from the currencies read.

**Admin functional fixes (same wave):**
- `/approvals` gated on `menu.approvals` (nav + route-access) so ops/finance checkers can reach
  their own maker-checker inbox (four-eyes was super_admin-only in the UI).
- KYC "Needs info" tab + users-directory bucket query `needs_info` (operators currently lose
  every bounced applicant).
- Restore the 4 orphan nav routes (/compliance, /beneficiaries, /roles, /sessions) and the agent
  conversations drawer (endpoints + components exist, unreachable).
- Honesty fixes: MakerCheckerModal copy states "applies immediately after step-up" on the nine
  surfaces that do apply immediately (four-eyes adoption for config writes → enhancement plan);
  sanctions Clear/Block thread the typed reason into `comment` (today silently dropped);
  "Resend receipt" button removed until an endpoint exists; the 4 unbacked feature flags render
  read-only "not wired" instead of fake-success toggles; sanctions monitoring switches become
  read-only status pills; users-directory Country/Velocity dead filters removed.
- Treasury approve step-up replay state bug (stash the pending row id); metrics route-access
  aligned to `menu.metrics`; broadcast `templateKey` validated fail-closed against the template
  store (api 422 + FE disables Send while the list is empty).
- web-admin user-detail Chat tab: replace the hardcoded design transcript with the real
  conversation read (or an honest empty state if the per-user filter is missing).

## Wave E — Documentation + guardrails (`docs/claude-md-refresh`)

Root CLAUDE.md: rewrite §11 as "Getting started" (deps ARE installed); fix §7 defaults path
(`configuration.ts`, not `api/config/defaults/*.json`); replace the "planned modules" list with
the actual 18; add web-admin to §1/§15 + AGENTS.md; link DEPLOYMENT/RAILWAY/runbooks/security
audit from §15; soften or make-true the §16 depcruise claims (Wave A lands the rules); amend §9
to describe the real coverage posture; add a "Known flakes" note. api/CLAUDE.md: document
worker.ts/cli/full core/, `dev` vs `start:dev`. contracts/CLAUDE.md: real src tree + exports,
drop "illustrative scaffolds". web/CLAUDE.md: test-script line fixed. Document the new features
(MCP, PAT, nicknames, settings endpoints, multi-currency conventions: always `formatFiat(value,
currency)`, never a bare ₦).

## Out of scope (enhancement plan — reported, not built)

R1 HttpOnly refresh cookie; R2 step-up on beneficiary-add; R4 argon2id; live market-feed
IRateProvider (quotes ride admin-set base rates — flagged HIGH for go-live ops); real KYC
provider (mock is the only impl; `KYC_MOCK_MODE` switches nothing; tier_1 hardcode TODOs);
ticketing vertical (no provider port; keep capability flag off); beneficiary currency/country
dimension + per-country bank lists (deepest single-currency assumption); conversational
save-beneficiary intent; four-eyes for config writes; CI e2e lane + coverage thresholds
(blocked on the two known-red suites on main); docker-compose.dev.yml + seed fixtures;
production boot guard for `SANCTIONS_MOCK_MODE` (needs an ops decision on the AML-enabled
Blockradar plan first).
