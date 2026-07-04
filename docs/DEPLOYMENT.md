# Deployment Guide — Handshake Agent

Complete deployment reference for the three deployable apps and their infrastructure:

| App | Path | What it is | Runtime |
|-----|------|-----------|---------|
| **Backend** | `api/` | NestJS 11 — system of record, deterministic execution engine, typed tool layer, embedded LangGraph agent. Two processes: the HTTP **API** and a **worker**. | Node (LTS) |
| **Frontend** | `web/` | Next.js 16 — the user-facing chat/wallet PWA. | Node (LTS) / edge |
| **Admin** | `web-admin/` | Next.js 16 — the operator console (separate auth/store). | Node (LTS) / edge |

> Safety context (non-negotiable, see [`CLAUDE.md`](../CLAUDE.md) §3): no LLM output moves money; the deterministic engine settles every transaction after PIN + step-up; the agent holds no DB credentials; every money-moving endpoint re-checks KYC/limits/sanctions server-side. A misconfiguration that weakens these is a **security bug**, not an ops nit — this guide calls those out inline.

---

## 1. Prerequisites

- **Node** — an LTS line: `^20.12 || ^22 || >=24`. (Node 23 is non-LTS; `dependency-cruiser` refuses to run on it. CI uses Node 22.)
- **pnpm** `10.x` (pinned via `packageManager`). `corepack use pnpm@10.25.0`.
- **PostgreSQL** 14+ (the schema uses `ALTER TYPE … ADD VALUE` migrations, native enums, `Decimal(38,18)` money columns; Prisma 7).
- **Redis** 6+ — required in production: BullMQ backs the durable **webhook-processing** queue and the **settlement outbox** worker. `REDIS_URL`.
- **Object storage / CDN** (optional) — for statements/receipts if you externalise them.
- A TLS-terminating reverse proxy / load balancer in front of every app.

Install + build the workspace once from the repo root:

```bash
corepack use pnpm@10.25.0
pnpm install --frozen-lockfile      # CI-parity install; commits the lockfile
pnpm build                          # turbo fans out: api (tsc) + web + web-admin (Next build)
```

---

## 2. Backend — `api/`

### 2.1 Two processes

The backend runs as **two OS processes sharing one codebase, DB, and Redis**:

| Process | Command (prod) | Responsibility |
|---------|----------------|----------------|
| **API** | `node dist/api/src/main` (`pnpm --filter @handshake-agent/api start:prod`) | HTTP: user + admin endpoints, webhook receivers (verify → **persist** → ACK fast). |
| **Worker** | `node dist/api/src/worker` | Drains BullMQ: webhook processing (idempotent settlement via the existing engine paths), settlement-outbox dispatch, dead-letter, `@Cron` sweepers + reconciliation. |

Run **at least one of each**. The worker is where money actually settles asynchronously; the API only persists intent and ACKs. Scale the worker for settlement throughput; scale the API for request volume.

### 2.2 Build & migrate

```bash
# from api/ (or `pnpm --filter @handshake-agent/api <script>`)
pnpm build                                  # nest build + tsc-alias
pnpm exec prisma generate                   # regenerate the client into api/generated/prisma
pnpm exec prisma migrate deploy             # apply committed migrations (idempotent, no prompts)
pnpm start:prod                             # API process
node dist/api/src/worker                    # worker process (separate deployment/unit)
```

`prisma migrate deploy` is the **only** migration command for prod/CI — never `migrate dev` (which prompts and can reset). Run it once per deploy, before the new API/worker start. Migrations are forward-only and non-destructive (e.g. the fiat-currency enum widen adds values, never drops).

### 2.3 Environment (`api/.env.example` is the source of truth)

Config is layered **DB-admin › env › JSON defaults** ([`CLAUDE.md`](../CLAUDE.md) §7); the env layer holds **secrets + infrastructure** and is validated by a Zod schema at boot — **invalid or missing required env fails startup** (fail-closed).

**Infrastructure**
```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://USER:PASS@HOST:5432/handshake_agent?schema=public
REDIS_URL=redis://HOST:6379           # required: BullMQ (webhook queue + outbox worker)
WEB_APP_BASE_URL=https://app.example.com     # CORS + deep links back to the user app
PUBLIC_API_BASE_URL=https://api.example.com  # absolute URLs in receipts/statements/webhooks
```

**Agent / LLM**
```
ANTHROPIC_API_KEY=…                   # SECRET
AGENT_MODEL=claude-opus-4-8           # default; overridable
```

**Crypto WaaS — Blockradar** (USDT on TRON at launch)
```
BLOCKRADAR_API_KEY=…                  # SECRET (also signs Blockradar webhooks)
BLOCKRADAR_BASE_URL=https://api.blockradar.co/v1
BLOCKRADAR_MASTER_WALLET_ID=…         # non-secret; per-user child addresses hang off it
```

**Fiat rails — Flutterwave**
```
FLUTTERWAVE_SECRET_KEY=…              # SECRET
FLUTTERWAVE_BASE_URL=https://api.flutterwave.com/v3
FLUTTERWAVE_WEBHOOK_SECRET=…          # SECRET — verify-hash for collection/transfer webhooks
```

**Email — Resend**
```
RESEND_API_KEY=…                      # SECRET
EMAIL_FROM=Handshake <no-reply@example.com>
```

**WhatsApp Cloud API + Flows** (only the official Cloud API — no unofficial automation, §3.5)
```
WHATSAPP_PHONE_NUMBER_ID=…            WHATSAPP_WABA_ID=…            WHATSAPP_APP_ID=…
WHATSAPP_GRAPH_VERSION=v25.0          WHATSAPP_GRAPH_BASE_URL=https://graph.facebook.com
WHATSAPP_ACCESS_TOKEN=…               # SECRET — System User permanent token
WHATSAPP_APP_SECRET=…                 # SECRET — HMAC for X-Hub-Signature-256
WHATSAPP_VERIFY_TOKEN=…               # SECRET — GET webhook handshake token
WHATSAPP_FLOW_PRIVATE_KEY=…           # SECRET — PEM for Flow E2E decryption; never logged
WHATSAPP_FLOW_ID=…                    WHATSAPP_BENEFICIARY_FLOW_ID=…
```

**KYC** (mocked at launch; provider TBD)
```
KYC_MOCK_MODE=true                    # flip to false with a real provider
KYC_PROVIDER_API_KEY=…  KYC_PROVIDER_BASE_URL=…
KYC_ENCRYPTION_KEY=…                  # SECRET — required when KYC_MOCK_MODE=false; AES-256-GCM for NIN/BVN at rest (§3.4)
```

**Voice / document media** (Whisper transcription + Claude-vision extraction)
```
TRANSCRIPTION_MOCK_MODE=true          TRANSCRIPTION_API_KEY=…  TRANSCRIPTION_BASE_URL=…  TRANSCRIPTION_MODEL=…
MEDIA_EXTRACTION_MOCK_MODE=true       MEDIA_EXTRACTION_MODEL=…   # reuses ANTHROPIC_API_KEY
```

**Signing keys** (rotate-friendly; prod boot guards reject empty in production)
```
DIRECTIVE_SIGNING_KEY=…   RECEIPT_SIGNING_KEY=…   STATEMENT_SIGNING_KEY=…   # all SECRET
```

**User auth**
```
JWT_SECRET=…                          # SECRET — empty disables token issuance (fail-closed)
AUTH_DEV_EXPOSE_OTP=false             # NON-PROD ONLY — echoes OTP in responses; MUST be false in prod
```

**Admin console auth** (separate, more-privileged)
```
ADMIN_JWT_SECRET=…                    # SECRET — signs admin session JWTs (distinct from JWT_SECRET)
ADMIN_MFA_ENC_KEY=…                   # SECRET — 64 hex chars: `openssl rand -hex 32` (AES-256-GCM for TOTP secrets)
ADMIN_BOOTSTRAP_TOKEN=…               # SECRET — one-time first-super_admin bootstrap (honoured only when 0 admins exist)
ADMIN_API_TOKEN=…                     # SECRET — legacy wallet-admin bearer; empty disables those endpoints
ADMIN_SESSION_TTL_SECONDS=28800       # 8h absolute session lifetime
ADMIN_STEP_UP_TTL_SECONDS=300         # 5m step-up (re-auth) freshness window
```

**Mock-mode master switches** — **all must be `false` for a real launch** (see the checklist in §5):
```
PAYMENTS_MOCK_MODE=true   WALLET_MOCK_MODE=true   SWAP_MOCK_MODE=true
NAME_ENQUIRY_MOCK_MODE=true   SANCTIONS_MOCK_MODE=true   KYC_MOCK_MODE=true
TRANSCRIPTION_MOCK_MODE=true   MEDIA_EXTRACTION_MOCK_MODE=true
```

### 2.4 Hardening (already in the app — verify it stays on)

- **Security headers** — strict CSP / `X-Frame-Options` / `nosniff` / HSTS are emitted by the app (helmet on the API; Next headers on web/admin). Don't strip them at the proxy.
- **Rate limiting** — a global throttler guards the API; **signed provider webhooks are `@SkipThrottle`d** (a settlement burst from a provider egress IP must never be 429'd — funds-safety). Keep webhook routes exempt from any proxy-level IP throttle too.
- **PIN + admin-login lockout** are atomic (single-statement) — DB-backed; no extra config.
- **Log redaction** — pino redacts `Authorization`/cookie/api-key/webhook-signature headers. Keep structured JSON logging in prod (no `pino-pretty`).

---

## 3. Frontend — `web/`

Next.js 16 (Turbopack; no `--turbopack` flag needed). Installable PWA + SEO baseline.

```bash
pnpm --filter @handshake-agent/web build     # Next production build (prerenders static routes)
pnpm --filter @handshake-agent/web start      # or deploy to a Next-compatible host
```

**Environment**
```
NEXT_PUBLIC_API_BASE_URL=https://api.example.com   # the backend API origin
NEXT_PUBLIC_SITE_URL=https://app.example.com       # canonical URL for SEO/OG/sitemap/manifest (PWA)
NEXT_PUBLIC_USE_MOCK=false                         # never true in prod
```

**PWA / SEO notes**
- The service worker (`public/sw.js`) is **network-first for navigations** with an `/offline` fallback, **cache-first** for immutable static assets, and **never caches `/api`** (auth/chat/wallet stay funds-safe). `robots.txt` disallows `/api`, `/kyc`, `/verify-email`.
- Icons/manifest/OG images are generated at build (`next/og`); no external asset host needed.
- Serve over HTTPS (PWA install + service worker require a secure origin).

---

## 4. Admin — `web-admin/`

Next.js 16 admin console — **separate auth and stores from `web/`**; do not share cookies/session.

```bash
pnpm --filter @handshake-agent/web-admin build
pnpm --filter @handshake-agent/web-admin start
```

**Environment**
```
NEXT_PUBLIC_API_BASE_URL=https://api.example.com   # same backend; admin routes are permissioned server-side
```

**First-admin bootstrap** (one-time): with `ADMIN_BOOTSTRAP_TOKEN` set on the API and **zero** admins in the DB, `POST /admin/bootstrap { token, email }` mints the first `super_admin` invitation; accept it, set a password, enrol MFA. The bootstrap route is inert once any admin exists. Rotate/blank the token afterward.

**Access notes**
- RBAC is default-deny and server-enforced; the nav only hides items the operator can't reach (UX), the API still gates every route.
- Admin money-actions require **permission + step-up (re-auth) + immutable audit**. Keep `ADMIN_STEP_UP_TTL_SECONDS` short.

---

## 5. Go-live / launch checklist

**Secrets & infra**
- [ ] `NODE_ENV=production` on all three apps.
- [ ] `DATABASE_URL` → managed Postgres 14+; `REDIS_URL` → managed Redis; both reachable from API **and** worker.
- [ ] All signing keys set (`DIRECTIVE_/RECEIPT_/STATEMENT_SIGNING_KEY`), `JWT_SECRET`, `ADMIN_JWT_SECRET` — non-empty (prod boot guards enforce).
- [ ] `ADMIN_MFA_ENC_KEY` = a fresh 64-hex value (`openssl rand -hex 32`).
- [ ] `KYC_ENCRYPTION_KEY` set (required once `KYC_MOCK_MODE=false`).

**Flip every mock to real**
- [ ] `PAYMENTS_MOCK_MODE=false` + real `FLUTTERWAVE_SECRET_KEY` + `FLUTTERWAVE_WEBHOOK_SECRET`.
- [ ] `WALLET_MOCK_MODE=false` + `SWAP_MOCK_MODE=false` + real `BLOCKRADAR_API_KEY` + master wallet.
- [ ] `NAME_ENQUIRY_MOCK_MODE=false`, `SANCTIONS_MOCK_MODE=false`, `KYC_MOCK_MODE=false` (with a live provider).
- [ ] `TRANSCRIPTION_MOCK_MODE` / `MEDIA_EXTRACTION_MOCK_MODE=false` if voice/media is enabled.
- [ ] `AUTH_DEV_EXPOSE_OTP=false`; `NEXT_PUBLIC_USE_MOCK=false`.

**Providers wired**
- [ ] Blockradar webhooks point at `POST /webhooks/blockradar`; deposits/withdrawals/swaps flow.
- [ ] Flutterwave webhooks point at `POST /webhooks/flutterwave` with the verify-hash secret.
- [ ] WhatsApp Cloud API webhook subscribed (GET handshake with `WHATSAPP_VERIFY_TOKEN`), Flows published, `WHATSAPP_FLOW_PRIVATE_KEY` matches the uploaded public key.
- [ ] Anthropic + Resend keys valid.

**Ops**
- [ ] Migrations applied (`prisma migrate deploy`); the fiat markets you're launching are **enabled server-side** (config `catalog.fiats.<code>.enabled` — fail-closed, requires pricing/limits).
- [ ] At least one **worker** process running (settlement, webhook processing, cron sweepers, reconciliation).
- [ ] First `super_admin` bootstrapped + MFA enrolled; `ADMIN_BOOTSTRAP_TOKEN` rotated/blanked.
- [ ] Reconciliation + webhook dead-letter dashboards watched (admin console: Reconciliation, Webhooks, System/Ops).

**Verify the invariants held** (the whole point of the architecture)
- [ ] No LLM output moves money; the engine settles after PIN + step-up (§3.1).
- [ ] Every money-moving endpoint re-checks KYC/limits/sanctions server-side (§3.3).
- [ ] The agent has no DB access (`pnpm depcruise` clean, §3.2).
- [ ] Security headers present; webhook routes exempt from throttling; logs redact tokens.

---

## 6. Operations quick reference

| Concern | Where | Notes |
|---------|-------|-------|
| DB migrations | `prisma migrate deploy` | Forward-only; run before new code starts. |
| Background work | worker process (`worker.ts`) | BullMQ; scale independently. Redis outage → the persist-first webhook design + `@Cron` sweeper re-enqueues on recovery (no lost settlements). |
| Inbound webhooks | `POST /webhooks/{blockradar,flutterwave}`, WhatsApp webhook | Verify signature → persist `WebhookEvent` → ACK 200 fast → worker settles idempotently. Dedup on `(provider, providerEventId)`. |
| Reconciliation | worker cron + admin **Reconciliation** page | Ledger vs provider/on-chain; drift surfaces in the console. |
| Config changes | admin console (DB-admin layer) | FX spread, fees, limits, service-enablement flags, message templates — hot-reloaded, no redeploy. |
| Metrics / health | admin **Metrics & analytics** + **System/Ops** | GMV/revenue/profit trends, KPIs (growth/churn/failed-jobs), per-provider health, queue depth. |
| Admin audit | admin **Audit log** | Immutable; every privileged action recorded. |

## 7. Health & observability

- API liveness: the process serves HTTP on `PORT`; put it behind an LB health check (any 2xx route or a dedicated probe).
- Worker liveness: monitor BullMQ queue depth + failed/dead counts (surfaced in the admin System/Ops board).
- Logs: structured JSON (pino) — ship to your aggregator; secrets are redacted.
- Alerts worth wiring: webhook dead-letter growth, reconciliation drift, settlement-outbox backlog, admin-login lockouts.

---

_Stack versions and per-package specifics live in [`api/CLAUDE.md`](../api/CLAUDE.md), [`web/CLAUDE.md`](../web/CLAUDE.md), and [`web-admin/CLAUDE.md`](../web-admin/CLAUDE.md). Architecture rationale is in [`docs/PRD.md`](PRD.md) (§4, the agent architecture) and the ADRs under [`docs/adr/`](adr/)._
