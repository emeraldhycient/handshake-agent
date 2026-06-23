# Runbook — WhatsApp `crypto.buy` staging

How to run and manually exercise the WhatsApp buy vertical (NGN → USDT) at a functional staging level. The code is complete and tested; this covers the **operator setup** the automated tests can't do (live Meta + tunnel + secrets).

## What's built

Inbound WhatsApp message → LangGraph agent emits a validated intent → deterministic engine creates a `Proposal` → itemized confirmation + PIN via an **E2E-encrypted WhatsApp Flow** → engine validates (re-quote drift, server-side KYC/velocity gate, one-shot signed directive, PIN) and creates a `Transaction` → opens a Flutterwave NGN virtual account → on payment, the Flutterwave webhook settles atomically (double-entry ledger + USDT credit + signed receipt) → receipt sent back on WhatsApp.

Safety invariants enforced: model-proposes/engine-disposes, agent has no DB access, server-side KYC + (now-enforcing) daily velocity gate, PIN + one-shot signed directive auth, idempotency end-to-end, PIN/KYC secrets only via Flow E2E, webhook signature verification.

## 1. Prerequisites

- Node LTS (`^20.12 || ^22 || >=24`), pnpm `10.x`, Docker.
- Dev Postgres (the tests + dev use a container):
  ```bash
  docker run -d --name handshake-agent-pg -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=handshake_agent -p 5544:5432 postgres:16
  pnpm --filter @handshake-agent/api exec prisma migrate deploy   # apply schema
  ```
- `pnpm install` at the repo root.

## 2. Secrets the operator must add to `api/.env` (gitignored)

Already present (test creds): `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `BLOCKRADAR_*`, `FLUTTERWAVE_*`, `DIRECTIVE_SIGNING_KEY` (generated).

You must add before a live run:

| Var                         | How to get it                                                                                                                                     | Gates                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `WHATSAPP_APP_SECRET`       | Meta App → Settings → Basic → App Secret                                                                                                          | Inbound webhook `X-Hub-Signature-256` verification                        |
| `WHATSAPP_VERIFY_TOKEN`     | A token you choose                                                                                                                                | GET webhook subscription handshake                                        |
| `WHATSAPP_FLOW_PRIVATE_KEY` | `openssl genrsa 2048` (PEM; `\n`-escape newlines in `.env`). Upload the **public** key to the WhatsApp Business phone number (Flows → encryption) | Flow E2E decrypt                                                          |
| `WHATSAPP_FLOW_ID`          | After publishing the confirmation+PIN Flow in the Meta dashboard                                                                                  | ConversationService sends the Flow (else falls back to text confirmation) |
| `WHATSAPP_WABA_ID`          | Meta WhatsApp Business Account id                                                                                                                 | Template management                                                       |
| `ANTHROPIC_API_KEY`         | Anthropic console                                                                                                                                 | The live agent (tests fake the LLM; empty is fine for non-agent paths)    |

> ⚠️ **`NODE_ENV=production` matters for security.** The inbound webhook signature guard **fails closed only in production**. In `development`/`test` with an empty `WHATSAPP_APP_SECRET` it logs a loud warning and ALLOWS (so you can drive it locally before the secret is set). Run staging that should reject forged webhooks with `NODE_ENV=production` **and** `WHATSAPP_APP_SECRET` set. (Flutterwave's `verif-hash` check fails closed in all environments.)

> ⚠️ The provided Meta **access token is a temporary (~24h) token** — replace it with a System User long-lived token for sustained staging.

## 3. Public HTTPS (Meta must reach two endpoints)

Meta calls the webhook and the Flow endpoint. Expose `localhost:3000` over HTTPS (tunnel or deployed host):

```bash
cloudflared tunnel --url http://localhost:3000        # or: ngrok http 3000
```

- **Webhook**: Meta App → WhatsApp → Configuration → Callback URL `https://<tunnel>/whatsapp/webhook`, Verify token = `WHATSAPP_VERIFY_TOKEN`; subscribe to `messages`.
- **Flow endpoint**: configure the Flow's data-exchange endpoint to `https://<tunnel>/whatsapp/flow` and upload the RSA public key.
- **Flutterwave**: dashboard → Settings → Webhooks → URL `https://<tunnel>/webhooks/flutterwave`, Secret hash = `FLUTTERWAVE_WEBHOOK_SECRET`.

## 4. Build & run

```bash
pnpm --filter @handshake-agent/api build      # nest build + tsc-alias (resolves the contracts alias)
NODE_ENV=production node api/dist/api/src/main.js
# expect: "Nest application successfully started" + route mappings, Prisma connected
```

(Dev iteration uses the test suites; `node dist/...` is the production-style boot.)

Smoke-test outbound (verifies the token is live):

```bash
pnpm --filter @handshake-agent/api send:test   # sends the hello_world template (needs dotenv: pnpm add -D dotenv)
```

## 5. Seed a Tier-1 user

The buy path requires a KYC-verified Tier-1 `User` with a bound device + PIN and a `ChannelIdentity` (whatsapp, your test phone) linked to it. (Real KYC capture is a future Flow; for staging, seed via Prisma Studio / a seed script: set `User.kycStatus='verified'`, `kycTier='tier_1'`, a scrypt PIN hash via `PinService`, and a linked `ChannelIdentity`.)

## 6. Drive the flow

From the test WhatsApp number, message the business number: **"buy 5000 naira of usdt"**.

1. You receive the confirmation **Flow** (itemized: USDT amount, fee, total).
2. Confirm + enter PIN in the Flow.
3. You receive the **NGN virtual account** to transfer ₦5,000 into (Flutterwave sandbox).
4. Pay it (sandbox) → the Flutterwave webhook settles → you receive the **receipt** on WhatsApp; the USDT is credited to your Blockradar (sandbox) wallet.

> ⚠️ Simulating an inbound NGN transfer to a Flutterwave virtual account in **test mode** is not clearly documented — you may need the dashboard's simulate/retry tooling or Flutterwave support to trigger `charge.completed`. The settlement itself re-verifies server-side and is idempotent.

## 7. Verifying it worked (DB)

`Transaction.status='completed'`, balanced `LedgerEntry` rows (sum 0 per currency), a `Receipt` row, `WalletBalance` credited, `SettlementOutbox.status='completed'`.

## Known follow-ups (tracked, non-blocking)

Overpayment reconciliation; `Number()`→BigInt at the KYC gate; cumulative `WalletBalance` semantics; receipt numbering via a Postgres sequence; session step-up (`Session.stepUpCompletedAt`) wiring; a dedicated `RECEIPT_SIGNING_KEY`; long-lived Meta token. See `.superpowers/sdd/progress.md` for the full list.
