# Railway Deployment — Config Report

Provisioned via the Railway CLI (`5.23.3`) on 2026-07-06. This documents **exactly**
what was created, every config value set, the gotchas hit, and everything still
required for a real go-live. No secret **values** appear here — only keys + their source.

---

## 1. Topology

**Workspace** `Handshake-agent` (`7ad6f3dd-ff0d-40f1-8871-efe484508a48`)
**Project** `handshake-agent` (`cb6057dc-0d00-422d-b66a-639b8c041866`)
Dashboard: https://railway.com/project/cb6057dc-0d00-422d-b66a-639b8c041866

**Environments**

| Env          | ID                                     | Creds posture                                                                                                                                   |
| ------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `production` | `3a9661af-1645-45ba-b4a5-7b6203b5525a` | Local creds baseline + `NODE_ENV=production` + `AUTH_DEV_EXPOSE_OTP=false`. **Testnet provider keys — must be swapped for real prod (see §6).** |
| `staging`    | `ef15be2d-d840-4709-8bbc-d0a51ab991f8` | **Mirrors the local `api/.env` exactly** (real testnet Blockradar/Flutterwave, `NODE_ENV=development`, dev-OTP on). Forked from production.     |

**Services** (one set, shared across both environments; each env has its own DB data + vars)

| Service    | ID                                     | Role                                              | Public domain (prod / staging)                 |
| ---------- | -------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| `api`      | `41c1f348-51c7-4817-a166-0ab2d5dea78a` | NestJS HTTP API (system of record, engine, agent) | `api-production-a720` / `api-staging-9438`     |
| `worker`   | `a2bc7a6d-a14a-4187-ac12-c4346ffc9125` | BullMQ worker (settlement, webhooks, cron)        | _(none — background)_                          |
| `web`      | `eb41bc30-eb1f-4192-a0a6-224a1e8aad8d` | Next.js user PWA                                  | `web-production-4c9d4` / `web-staging-8833`    |
| `admin`    | `e72d62a0-3941-4d46-a533-5e2ac2326524` | Next.js operator console                          | `admin-production-e39f` / `admin-staging-0671` |
| `Postgres` | `2a1e3d9a-295f-4322-9a43-5c050ed0ac12` | Managed Postgres 18                               | private only                                   |
| `Redis`    | `59747fb3-57be-4b9a-82fb-7a964657c7a0` | Managed Redis (BullMQ)                            | private only                                   |

All web domains are `https://<name>.up.railway.app`.

---

## 2. Source & build (all four app services)

- **GitHub source:** `emeraldhycient/handshake-agent` @ branch `main` (connected via `railway service source connect`; pushes to `main` auto-deploy, gated by watch patterns).
- **Builder:** Railpack. It correctly detects the pnpm + Turborepo workspace, runs `pnpm install`, honours `pnpm.onlyBuiltDependencies` (Prisma engine builds), then the per-service build command below. **No Dockerfile or `railway.json` was needed.**
- **Watch patterns** limit redeploys: `api`/`worker` watch `api/**` + `packages/**` + lockfile/`package.json`/`turbo.json`; `web` watches `web/**`; `admin` watches `web-admin/**`. (So a docs-only or web-only change won't rebuild the api.)

| Service  | Build command                                                                                         | Start command                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `api`    | `pnpm --filter @handshake-agent/api exec prisma generate && pnpm --filter @handshake-agent/api build` | `pnpm --filter @handshake-agent/api exec prisma migrate deploy && pnpm --filter @handshake-agent/api start:prod` |
| `worker` | _(same as api)_                                                                                       | `pnpm --filter @handshake-agent/api start:worker`                                                                |
| `web`    | `pnpm --filter @handshake-agent/web build`                                                            | `pnpm --filter @handshake-agent/web start`                                                                       |
| `admin`  | `pnpm --filter @handshake-agent/web-admin build`                                                      | `pnpm --filter @handshake-agent/web-admin start`                                                                 |

`prisma migrate deploy` runs on the **api** start only (idempotent, forward-only). The worker does not migrate.

---

## 3. Environment variables

### 3a. Infrastructure (set by me, per env — **not** from local `.env`)

| Key                   | Value                        | Notes                                                                                                                              |
| --------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | `${{Postgres.DATABASE_URL}}` | Railway reference → each env's own Postgres (private network)                                                                      |
| `REDIS_URL`           | `${{Redis.REDIS_URL}}`       | Railway reference → each env's own Redis                                                                                           |
| `PORT`                | _(unset)_                    | Railway injects it; the app reads `process.env.PORT`. Local `.env` `PORT=3000` was **omitted** (it collides with Railway routing). |
| `PUBLIC_API_BASE_URL` | the env's api domain         | prod → `api-production-a720…`, staging → `api-staging-9438…`                                                                       |
| `WEB_APP_BASE_URL`    | the env's web domain         | CORS + deep links                                                                                                                  |

**web** service: `NEXT_PUBLIC_API_BASE_URL` = env's api domain, `NEXT_PUBLIC_SITE_URL` = env's web domain, `NEXT_PUBLIC_USE_MOCK=false`, `NODE_ENV=production`.
**admin** service: `NEXT_PUBLIC_API_BASE_URL` = env's api domain, `NODE_ENV=production`.

### 3b. api + worker application vars (41 keys, copied from local `api/.env` → both envs)

Set identically on `api` and `worker` (same codebase, DB, Redis, secrets). **Staging = local values verbatim.** Production = same values **except** `NODE_ENV=production` and `AUTH_DEV_EXPOSE_OTP=false`.

| Group                    | Keys                                                                                                                                                                                                               | Source / status                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Agent / LLM              | `ANTHROPIC_API_KEY`, `AGENT_MODEL`, `ANTHROPIC_BASE_URL`\*                                                                                                                                                         | real (local)                                                                                                              |
| Blockradar (crypto/TRON) | `BLOCKRADAR_API_KEY`, `BLOCKRADAR_MASTER_WALLET_ID`, `BLOCKRADAR_BASE_URL`                                                                                                                                         | real **testnet** (local)                                                                                                  |
| Flutterwave (NGN)        | `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_BASE_URL`, `FLUTTERWAVE_WEBHOOK_SECRET`, `FLUTTERWAVE_SCENARIO_KEY`                                                                                                         | real **testnet** (local)                                                                                                  |
| Email (Resend)           | `RESEND_API_KEY`, `EMAIL_FROM`                                                                                                                                                                                     | local                                                                                                                     |
| WhatsApp                 | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_APP_ID`, `WHATSAPP_TEST_RECIPIENT`                                                                                        | local; `WHATSAPP_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN`/`WHATSAPP_FLOW_PRIVATE_KEY`/`WHATSAPP_WABA_ID` are **empty** locally |
| KYC (Sumsub)             | `KYC_ENCRYPTION_KEY`, `KYC_MOCK_MODE`, `SUMSUB_API_TOKEN`, `SUMSUB_API_SECRET_KEY`, `SUMSUB_WEBHOOK_SECRET`, `SUMSUB_BASE_URL`, `SUMSUB_LEVEL_TIER2`, `SUMSUB_LEVEL_TIER3`                                          | local (Sumsub secrets/levels required when `KYC_MOCK_MODE=false`)                                                         |
| Signing keys             | `DIRECTIVE_SIGNING_KEY`, `RECEIPT_SIGNING_KEY`, `STATEMENT_SIGNING_KEY`                                                                                                                                            | local (**regenerate for real prod — see §6**)                                                                             |
| User auth                | `JWT_SECRET`, `AUTH_DEV_EXPOSE_OTP`                                                                                                                                                                                | local (`AUTH_DEV_EXPOSE_OTP` forced `false` in prod)                                                                      |
| Admin console            | `ADMIN_JWT_SECRET`, `ADMIN_MFA_ENC_KEY`, `ADMIN_API_TOKEN`, `ADMIN_BOOTSTRAP_TOKEN`                                                                                                                                | **generated locally this session** (see §4); regenerate for real prod                                                     |
| Mock switches            | `PAYMENTS_MOCK_MODE=false`, `WALLET_MOCK_MODE=false`, `SWAP_MOCK_MODE=false`, `NAME_ENQUIRY_MOCK_MODE=false`, `SANCTIONS_MOCK_MODE=true`, `KYC_MOCK_MODE`, `TRANSCRIPTION_MOCK_MODE`, `MEDIA_EXTRACTION_MOCK_MODE` | local values (real testnet money paths are ON)                                                                            |

\* = schema default; carried through.

> Railway also auto-injects ~8 `RAILWAY_*` vars per service (region, private domain, git metadata).

---

## 4. Codebase / local changes made to enable deploy

1. **`api/src/worker.module.ts`** — fixed a real DI bug so the worker boots (PR #33). The `@Processor` classes inject `USER_LISTER`/`WalletService`/`WALLET_REPOSITORY`/`BACKFILL_RUN_REPOSITORY`/`AssetRegistry`, but `WorkerModule` only imported `AppModule` (which doesn't re-export children). Added direct imports of `IdentityModule`, `WalletsModule`, `CatalogModule`. _(First time the worker has ever been booted.)_
2. **`api/.env`** (local, gitignored) — added `ADMIN_MFA_ENC_KEY` (64-hex), `ADMIN_JWT_SECRET`, `ADMIN_API_TOKEN`, `ADMIN_BOOTSTRAP_TOKEN`. The merged admin module's `MfaSecretCipher` fail-closes at boot without a valid `ADMIN_MFA_ENC_KEY`. These were then copied into both Railway envs.
3. No Dockerfiles / `railway.json` / `nixpacks.toml` were added — Railpack + CLI-set build/start commands cover the monorepo.

---

## 5. Deploy status (2026-07-06)

| Service          | staging                                                                     | production                                    |
| ---------------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| api              | ✅ SUCCESS — `/config` 200, `auth/login/request` → `otp_sent`               | ✅ SUCCESS (redeploying after prod-hardening) |
| web              | ✅ SUCCESS — 200                                                            | ✅ SUCCESS                                    |
| admin            | ✅ SUCCESS — 200                                                            | ✅ SUCCESS                                    |
| worker           | ✅ SUCCESS — "BullMQ worker started"; recon + webhook-sweeper crons running | ✅ SUCCESS                                    |
| Postgres / Redis | ✅ provisioned                                                              | ✅ provisioned                                |

Verified live (staging): `https://api-staging-9438.up.railway.app/config` returns the real fiat/asset catalog (DB-connected), and the login handshake works. The worker boots clean after the PR #33 fix (`a265eab`) merged to `main`.

> **Minor non-blocking warning** in the worker log: `ConfigInvalidationSubscriber … Stream isn't writeable / enableOfflineQueue false` — the Redis **pub/sub** subscribe for cross-instance config invalidation didn't connect at boot; it degrades gracefully ("single-instance refresh still applies"). The BullMQ worker connection itself is fine. Only matters if you run multiple API/worker replicas and change config via the admin console expecting instant cross-instance propagation; worth a look before scaling out.

---

## 6. Required before a REAL production launch

Production currently runs on the **local testnet credentials**. Before real money/users:

- [ ] Swap **real prod** provider keys into the `production` env: `ANTHROPIC_API_KEY`, `BLOCKRADAR_API_KEY` + `BLOCKRADAR_MASTER_WALLET_ID`, `FLUTTERWAVE_SECRET_KEY` + `FLUTTERWAVE_WEBHOOK_SECRET`, `RESEND_API_KEY` + verified `EMAIL_FROM` domain, WhatsApp (`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN`/`WHATSAPP_FLOW_PRIVATE_KEY`/`WHATSAPP_PHONE_NUMBER_ID`).
- [ ] **Regenerate fresh secrets for prod** (don't reuse testnet/local): `DIRECTIVE_/RECEIPT_/STATEMENT_SIGNING_KEY`, `JWT_SECRET`, `ADMIN_JWT_SECRET`, `ADMIN_MFA_ENC_KEY` (`openssl rand -hex 32`), `KYC_ENCRYPTION_KEY`.
- [ ] Confirm mock switches match intent (they're currently `false` for payments/wallet/swap/name-enquiry — real money paths ON; `SANCTIONS_MOCK_MODE=true`, `KYC_MOCK_MODE` per launch).
- [ ] Point provider webhooks at the api domain: `POST /webhooks/blockradar`, `POST /webhooks/flutterwave`, WhatsApp GET handshake (`WHATSAPP_VERIFY_TOKEN`).
- [ ] Add custom domains (currently `*.up.railway.app`) + update `PUBLIC_API_BASE_URL`/`WEB_APP_BASE_URL`/`NEXT_PUBLIC_*` accordingly.
- [ ] Bootstrap the first `super_admin` (`POST /admin/bootstrap` with `ADMIN_BOOTSTRAP_TOKEN`, zero admins), enrol MFA, then blank the token.
- [ ] Ensure ≥1 `worker` replica is running per env (settlement/webhooks/cron).
- [ ] Full go-live checklist: [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) §5.

---

## 7. CLI gotchas (for future ops)

- **`railway environment edit --service-config build.buildCommand / deploy.startCommand / source.repo` silently no-ops** (only `build.builder` persisted). Use the dedicated `railway service source connect --repo … --branch …` for source, and the GraphQL `serviceInstanceUpdate` mutation for build/start commands.
- **The skill's `railway-api.sh` reads `.user.token`, but the OAuth CLI stores `.user.accessToken`.** A one-line helper reading `accessToken` fixes GraphQL auth.
- **Inline `.env` comments break enum vars.** `SANCTIONS_MOCK_MODE=true  # …` was ingested with the comment → boot failed on the `true|false` enum. Strip ` #…` when copying `.env` → Railway.
- **Don't set `PORT`** — Railway injects it; a hardcoded value breaks routing.
- **`variableCollectionUpsert`** (GraphQL) sets many vars in one call; `replace:true` for a full set, `replace:false` to merge.
- Setting vars **auto-triggers a deploy**; use `--skip-deploys` (CLI) or batch the upsert before the first deploy to avoid churn.

---

## 8. Quick command reference

```bash
export PATH="$HOME/.railway/bin:$PATH"
railway link --project cb6057dc-0d00-422d-b66a-639b8c041866
railway environment list
railway variable list --service api --environment staging --kv     # inspect (raw values)
railway logs --service api --environment production --lines 200     # runtime
railway logs --service api --environment production --build         # build
railway redeploy --service worker --environment production --yes    # redeploy one service
railway deployment list --service api --environment staging --json  # status
```
