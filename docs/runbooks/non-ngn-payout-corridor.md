# Runbook: Bringing a new (non-NGN) fiat payout corridor live

**Audience:** Ops / treasury / engineering. Read before enabling any settlement currency other than NGN in production.

This runbook covers turning on a **sell/payout corridor** for a currency that ships _supported-but-disabled_ (`GHS`, `KES`, `UGX`, `TZS`, `RWF`, `ZAR`, `USD`) or a brand-new currency you added at runtime. The launch corridor (NGN → Nigerian bank) is already live; nothing here changes it.

> **The one rule that orders everything below:** every gate on the money path is **fail-closed**. A currency with no pricing cannot be enabled; a currency with no large-payout threshold requires maker-checker approval on _every_ payout; a currency whose `catalog.fiats.<CODE>.enabled` flag is off cannot settle a single transaction. So you configure **inward-out** — pricing → limits → treasury thresholds → float funding → live verification — and **flip the live flag dead last**. Flipping it first just produces user-visible failures, never a wrong payout.

---

## 0. Why this is safe by construction

You cannot accidentally move money to the wrong place while a corridor is half-configured:

- **Enablement is gated on pricing.** Enabling a currency (custom-fiat console) calls `assertPricingExists` — it throws `MultiCurrencyInvariantError` (→ 422) unless at least one priced asset carries a `pricing.assets.<ASSET>.baseRates.<CODE>` entry. Built-in fiats are gated the same way through the settings console's multi-currency invariant.
- **The payout body fails closed, never wrong.** `FlutterwaveProvider.buildTransferBody` derives the corridor from `(country, rail)`. The **NG bank** branch is byte-identical to the original NG-only body (no `beneficiary_name`). **Every other corridor** (non-NG bank, or any `mobile_money` rail) _adds_ `beneficiary_name`; if that or any required field is missing/wrong, Flutterwave returns a 4xx, `ExecutionService` treats it as a definitive provider rejection, and `settleSellRefundAtomic` refunds the reserve and marks the tx failed. A misconfigured non-NGN corridor rejects — it does not misroute.
- **Country is derived server-side.** `AssetRegistry.countryForFiat(code)` maps the currency to its ISO alpha-2 country (`NGN`→`NG`, `GHS`→`GH`, …); the client-supplied country is never trusted (§3.3). A fiat with no `country` mapping throws `UnsupportedFiatError` (fail-closed) rather than inventing one.

---

## 1. Preconditions (before you touch config)

1. **Flutterwave corridor is live-tested.** The collection (virtual-account / deposit) **and** disbursement (Transfers API) for the target market are enabled on the live Flutterwave account, and a manual test transfer in that currency has succeeded from the Flutterwave dashboard.
2. **Compliance review complete.** KYC-tier limits, sanctions posture, and any market-specific travel-rule requirement for the corridor are signed off. (`limits.<CODE>.<tier>.*` are set in step 3; they are a hard server-side gate, §3.3.)
3. **Provider data resolved — the `TODO(NG-LIVE)` lookup.** For a **bank** corridor, confirm the bank-code list Flutterwave expects for that country. For a **`mobile_money`** corridor, you must resolve the **per-network scheme code** (the `account_bank` value for MTN GH, M-Pesa KE, Airtel UG, etc.) from **Flutterwave's live transfer-bank list** — `buildTransferBody` threads whatever `bankCode` the beneficiary carries **verbatim and never guesses a code**. The beneficiary's `bankCode` must be the correct scheme code and the wallet/phone must be its `accountNumber`. Until this is confirmed for a mobile-money market, do **not** enable that corridor. (`mobile_money` is not a launch corridor; bank corridors are the default.)
4. **A test beneficiary exists** in the target currency (real account in that market) for the step-5 live verification.

---

## 2. Configure pricing (`Pricing` category — settings console, maker-checker)

Set these for **at least one** priced asset (`USDT` at launch; `BTC`/`TRX` as applicable). Without a base rate keyed by the currency code, the currency can never be enabled.

| Key | Meaning |
| --- | --- |
| `pricing.assets.<ASSET>.baseRates.<CODE>` | **Required.** Mid-market `<CODE>` rate per 1 `<ASSET>`. Fallback baseline when the live feed is off (`pricing.feed.enabled=false`). |
| `pricing.assets.<ASSET>.sellSpreadBps` | Platform spread folded into SELL quotes (marks the payout rate down). |
| `pricing.assets.<ASSET>.buySpreadBps` | Platform spread folded into BUY quotes (only if you also enable buy in this currency). |
| `pricing.assets.<ASSET>.minFiat.sell.<CODE>` / `pricing.assets.<ASSET>.maxFiat.sell.<CODE>` | Optional per-market sell band; the engine rejects a sell outside it. |

For a **built-in** fiat every key above is already registered per `KNOWN_FIAT_CURRENCIES`. For a **runtime custom** fiat the settings console resolves the dynamic key against the `NGN` template (same value-type and bounds — validation is reused, never loosened) once the CustomFiat row exists.

---

## 3. Configure per-tier limits (`KYC` category — settings console, maker-checker)

Set the per-currency, per-tier caps. A currency is fail-closed until its limits exist; the gate resolves `limits[fiatCurrency]` per currency (§3.3):

- `limits.<CODE>.tier_1.perTxFiatMax`, `limits.<CODE>.tier_1.dailyFiatMax`, … (repeat for `tier_2`, `tier_3`).

Only NGN ships defaults; every other currency must be set before it goes live.

---

## 4. Configure treasury oversight + fund the float (`Config` category)

Registered per `KNOWN_FIAT_CURRENCIES` (root CLAUDE.md §7); resolved through the DB-admin layer.

| Key | Default | Behaviour |
| --- | --- | --- |
| `treasury.largePayoutThresholds.<CODE>` | **unset (except NGN=1,000,000)** | **Fail-closed:** a currency with no threshold flags **every** payout for maker-checker approval before release. Set a real threshold (in `<CODE>` major units) so routine payouts auto-release and only large ones queue. |
| `treasury.fiatFloatTargets.<CODE>` | `0` for every currency | **Opt-in:** `0` = no target (float always reported "healthy"). Set the desired operating float (major units) so the treasury float-health view can flag the corridor "low". |
| `treasury.lowFloatThresholdBps` | `2500` (25%) | **Global** knob shared by every currency: float is flagged "low" when balance/target utilization drops below this fraction. |

**Fund the operating float.** Fund the Flutterwave balance in `<CODE>` to at least `treasury.fiatFloatTargets.<CODE>` so payouts settle without a low-float alert. Payouts draw from this balance — an unfunded corridor will low-float-alert (if a target is set) or start rejecting at the provider (insufficient balance → 4xx → auto-refund) once live.

> **Decision on the large-payout threshold:** leaving `treasury.largePayoutThresholds.<CODE>` unset is the _safe_ default (everything needs approval) but operationally heavy. Set it deliberately before go-live; do not enable the corridor expecting auto-release without it.

---

## 5. Verify with one live sandbox → live payout, webhook, and reconciliation

Do this **while `catalog.fiats.<CODE>.enabled` is still `false`** — operators can transact but the currency is not yet offered to users. (If your process requires the flag on to route a sell, gate the corridor to a single internal test account for this step, then continue.)

1. **One real sell → payout.** Run a single small sell in `<CODE>` to the step-1 test beneficiary end-to-end. Confirm the Flutterwave Transfers call succeeds and the funds land in the destination account.
2. **Webhook lands and settles.** Confirm the Flutterwave payout webhook is received, verified, persisted (durable `WebhookEvent` queue), and drives the settlement to a terminal state — no stuck `pending`.
3. **Rejection path refunds.** Force one rejection (e.g. a deliberately bad account number) and confirm the 4xx path refunds the reserve and marks the tx failed (no double-spend, no stranded reserve).
4. **Reconciliation is clean.** Run the treasury reconciliation for the corridor and confirm the payout appears with a matched breakless run (ledger ↔ provider agree). Investigate any `ReconBreak` before proceeding.

Only when all four pass do you flip the live flag.

---

## 6. Flip the live flag — last

- **Built-in fiat** (`GHS`/`KES`/`UGX`/`TZS`/`RWF`/`ZAR`/`USD`): set `catalog.fiats.<CODE>.enabled = true` via the settings console (goes through maker-checker). The AssetRegistry overlay hot-reloads; the currency starts settling immediately, no deploy.
- **Runtime custom fiat** (a code outside `KNOWN_FIAT_CURRENCIES`): its liveness is owned by the **Currency console** — set the CustomFiat row's `enabled = true` (which re-checks `assertPricingExists`). Do **not** try to set `catalog.fiats.<CODE>.enabled` for a custom fiat; that override is a deliberate dead toggle the money path never reads.

The frontends read effective non-secret flags from `GET /config` (TanStack-cached), so the corridor appears to users shortly after the flip.

---

## 7. Post-enable monitoring (first 24–48h)

- Watch the treasury float-health view for `<CODE>` (funded above `fiatFloatTargets.<CODE>`; not "low").
- Watch payout success/failure rates and the maker-checker queue depth for `largePayoutThresholds.<CODE>`.
- Watch reconciliation runs for the corridor for new `ReconBreak`s.
- **Rollback is instant and safe:** set `catalog.fiats.<CODE>.enabled = false` (or the CustomFiat `enabled = false`). Fail-closed means no new transaction can settle in the currency; in-flight settlements complete normally.

---

## Appendix — config key reference

| Concern | Key(s) | Registry category |
| --- | --- | --- |
| Base rate | `pricing.assets.<ASSET>.baseRates.<CODE>` | Pricing |
| Sell / buy spread | `pricing.assets.<ASSET>.sellSpreadBps` · `…buySpreadBps` | Pricing |
| Sell band | `pricing.assets.<ASSET>.minFiat.sell.<CODE>` · `…maxFiat.sell.<CODE>` | Pricing |
| Per-tier limits | `limits.<CODE>.<tier>.perTxFiatMax` · `…dailyFiatMax` (…) | KYC |
| Large-payout approval | `treasury.largePayoutThresholds.<CODE>` (fail-closed if unset) | Config |
| Float target | `treasury.fiatFloatTargets.<CODE>` (opt-in; `0` = no target) | Config |
| Low-float floor | `treasury.lowFloatThresholdBps` (global, `2500` bps default) | Config |
| **Live flag (last)** | `catalog.fiats.<CODE>.enabled` (built-in) · CustomFiat `enabled` (custom) | Config / Currency console |

**Source of truth:** `packages/contracts/src/admin/settings.ts` (`SETTING_REGISTRY`) and `api/src/core/config/configuration.ts` (`TreasuryConfig`, catalog `fiats`). Payout-body corridor logic: `api/src/modules/treasury/infrastructure/flutterwave.provider.ts` (`buildTransferBody`, `TODO(NG-LIVE)`). Enable gate: `api/src/modules/admin/application/admin-currency.service.ts` (`assertPricingExists`).
