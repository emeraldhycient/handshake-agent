# Admin Dashboard — Phase 1 (Config, Service Registry, Pricing, Catalog, KYC) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Checkbox steps.

**Goal:** Make every business-tunable value editable from the admin console without a deploy: a layered `EffectiveConfigService` (DB `AppSetting` › env › JSON, synchronously readable so the money path stays fast), a per-key Zod validation registry, an audited `AdminSettingsService` CRUD, all 18 `TODO(config-admin)` consumers migrated to read through it, and admin pages for settings / service-enablement / pricing-economics / catalog / KYC config.

**Architecture:** `EffectiveConfigService` builds a deep-merged `AppConfig` snapshot (base = `configuration()` JSON+env; overlay = editable `AppSetting` rows keyed by dot-path) at boot and rebuilds it on a Redis `config:invalidate` message published by every settings write. It exposes the same `get<T>(key)` shape the existing `ConfigService<AppConfig>` consumers use, so migration is an injection swap with identical behavior when no override exists. Secrets (`isSecret`) are never returned to the UI; `isEditable=false` keys reject writes; every write is audited before→after.

**Tech Stack:** NestJS 11, Prisma 7, Redis (ioredis/BullMQ connection already present), Zod + nestjs-zod, contracts, Next 16 web-admin.

## Global Constraints
- Money-path reads stay **synchronous** (no async in pricing/limits math) — `EffectiveConfigService.get` reads an in-memory snapshot. (CLAUDE.md §5/§7)
- DB overrides resolve **DB › env › JSON**; behavior identical to today when no `AppSetting` row exists (TDD-locked). (§7)
- `isSecret` settings never returned by any admin read; `isEditable=false` settings reject writes; secrets/infra (signing keys, `DATABASE_URL`, `*_SECRET`) are NOT in the registry — env-only. (§7, task brief)
- Every settings write is audited (before→after, actorAdminId) and requires admin step-up for money-affecting/limit-changing keys. (NFR-3)
- Multi-currency invariant: every **enabled** fiat must have tier limits + base rates; enabling a fiat without them is rejected with a clear error. (task brief)
- Cross-boundary shapes from `@handshake-agent/contracts`; the config-key registry is defined once there and consumed by API (validation) + web-admin (form rendering). (§8)
- Strict TDD; ~100% on the layered resolution, override application, validation, isEditable/secret enforcement, and the multi-currency invariant. (§9)
- Admin endpoints RBAC-gated with new `Config`/`Pricing`/`Catalog`/`KYC` catalog permissions; default-deny. (Phase 0)

## File structure
**contracts** (`packages/contracts/src/admin/`): `settings.ts` (`SETTING_REGISTRY` array of `{key, scope, category, editable, secret, valueType, label, description, min?, max?, options?}`, `settingZod(key)` builder, `AdminSettingValueSchema`), `settings.dto.ts` (effective-settings list/get/update DTOs), `session.dto.ts` (promote `AdminSessionView` — closes the Phase-0 §8 drift).
**api** (`api/src/`):
- `core/config/` — `application/effective-config.service.ts` (+spec), `application/ports/app-setting.repository.port.ts`, `infrastructure/app-setting.prisma.repository.ts` (+integration spec), `infrastructure/config-invalidation.publisher.ts` + `.subscriber.ts` (Redis pub/sub), `domain/config-merge.ts` (pure deep-merge/dot-path) (+spec), `effective-config.module.ts` (`@Global`).
- `modules/admin/application/admin-settings.service.ts` (+spec) — list effective / update (validate via registry, reject non-editable, audit, publish invalidation). `domain/settings-errors.ts` (`SettingNotEditableError`, `SettingValidationError`, `MultiCurrencyInvariantError`).
- `modules/admin/presentation/admin-settings.controller.ts` (+ DTO) — `GET /admin/settings`, `GET /admin/settings/:key`, `PATCH /admin/settings/:key`; catalog-enablement + pricing + KYC are the same endpoints filtered by `category`.
- Promote sessions to a contract: `admin-sessions.controller.ts` parses through the new `AdminSessionView` contract schema.
- **Migrate consumers** to inject `EffectiveConfigService`: `kyc-gate.service`, `quotes`/rate-provider (pricing), `execution.service`, `proposal.service`, `settlement-reconciliation.service`, `beneficiary.service` (cooling-off), `compliance` (travel-rule/denylist), `statement.service`, `catalog/asset-registry`, `swap`/`buy`/`sell` readers, `directive` reader. (auth.* PIN/JWT readers stay on plain `ConfigService` — they're security-infra, registry marks them non-editable or omits them.)
**web-admin** (`web-admin/`): `app/settings/`, `app/pricing/`, `app/catalog/`, `app/kyc/` pages + `components/admin/settings-*`.

---

## Task 1: AppSetting repository + config-key registry (contracts)
**Files:** contracts `admin/settings.ts` (+spec); api `core/config/application/ports/app-setting.repository.port.ts`, `infrastructure/app-setting.prisma.repository.ts` (+e2e spec).
**Interfaces:**
```ts
// contracts
export type SettingValueType = 'number' | 'string' | 'boolean' | 'string[]'
export interface SettingRegistryEntry { key: string; scope: 'global'|'tier'|'provider'; category: 'Config'|'Pricing'|'Catalog'|'KYC'|'Compliance'|'Beneficiary'|'Comms'; editable: boolean; secret: boolean; valueType: SettingValueType; label: string; description: string; min?: number; max?: number; options?: string[] }
export const SETTING_REGISTRY: readonly SettingRegistryEntry[]
export function settingSchemaFor(key: string): z.ZodTypeAny  // built from the entry's valueType + min/max/options
// api port
export const APP_SETTING_REPOSITORY = Symbol('APP_SETTING_REPOSITORY')
export interface AppSettingRow { key: string; value: unknown; scope: 'global'|'tier'|'provider'; scopeValue: string|null; isSecret: boolean; isEditable: boolean }
export interface IAppSettingRepository { findAllEditable(): Promise<AppSettingRow[]>; findByKey(key, scope, scopeValue): Promise<AppSettingRow|null>; upsert(input: {key;value;scope;scopeValue;isSecret;isEditable;updatedByAdminId}): Promise<AppSettingRow>; findAll(): Promise<AppSettingRow[]> }
```
- [ ] Spec the registry: every entry has a non-empty key/label/category; `settingSchemaFor` accepts a valid value and rejects an out-of-range one; the registry covers the money-path keys (`pricing.processingFeeBps`, `pricing.assets.USDT.buySpreadBps`, `limits.NGN.tier_1.perTxFiatMax`, `compliance.travelRuleThresholds.NGN`, `catalog.capabilities.crypto.buy`, `beneficiary.cryptoCoolingOffSeconds`). Implement.
- [ ] Repo integration spec (testcontainers): upsert is idempotent by `(key,scope,scopeValue)`; `findAllEditable` excludes `isEditable=false`; round-trips JSON values. Implement.
- [ ] Commit `feat(contracts): config-key registry` + `feat(api): app-setting repository`.

## Task 2: config-merge domain + EffectiveConfigService
**Files:** `core/config/domain/config-merge.ts` (+spec); `core/config/application/effective-config.service.ts` (+spec); `effective-config.module.ts` (`@Global`); Redis publisher/subscriber.
**Interfaces:**
```ts
// domain (pure)
export function getAtPath(obj: unknown, dotPath: string): unknown
export function setAtPath<T>(obj: T, dotPath: string, value: unknown): T  // immutable deep set
export function applyOverrides(base: AppConfig, rows: {key:string;value:unknown}[]): AppConfig  // global-scope rows set base[key]=value
// service
export class EffectiveConfigService implements OnModuleInit {
  get<T>(key: string): T   // resolves dot-path on the merged snapshot; SAME shape as ConfigService.get
  refresh(): Promise<void> // rebuild snapshot from repo.findAllEditable()
}
```
- [ ] `config-merge.spec`: `setAtPath` is immutable + creates a deep copy; `getAtPath('pricing.assets.USDT.buySpreadBps')` reads nested; `applyOverrides` overlays only the given keys, leaving the rest of base intact. Implement.
- [ ] `effective-config.service.spec` (mock repo): with NO rows, `get('pricing')`/`get('limits.NGN.tier_1.perTxFiatMax')` === the base `configuration()` values (behavior-identical); with an override row, `get` returns the overridden value; `refresh()` picks up new rows; `get` of an unknown key returns the base/undefined like ConfigService. Implement (build base via `configuration()`, overlay rows, cache snapshot; `get` resolves dot-path).
- [ ] Redis invalidation: `ConfigInvalidationPublisher.publish()` (publishes to channel `config:invalidate`) + a subscriber that calls `effectiveConfig.refresh()`. Spec the publisher calls the redis client; wire the subscriber in the module `onModuleInit`. (Use the existing ioredis/BullMQ connection or a dedicated client from `REDIS_URL`.)
- [ ] `EffectiveConfigModule` `@Global` provides+exports `EffectiveConfigService` + `APP_SETTING_REPOSITORY`; register in `app.module`. Commit `feat(api): layered EffectiveConfigService with redis invalidation`.

## Task 3: AdminSettingsService + controller + DTOs
**Files:** `modules/admin/application/admin-settings.service.ts` (+spec); `domain/settings-errors.ts`; `presentation/admin-settings.controller.ts` (+dto); contracts `admin/settings.dto.ts`.
**Interfaces:**
```ts
AdminSettingsService: {
  listEffective(category?): Promise<EffectiveSetting[]>  // merges registry + current effective value + which layer (db|env|json) it came from; OMITS secret entries
  get(key): Promise<EffectiveSetting>
  update(key, value, scope, scopeValue, adminId): Promise<EffectiveSetting>  // 1) registry lookup or throw; 2) if !editable throw SettingNotEditableError; 3) settingSchemaFor(key).parse(value) or throw SettingValidationError; 4) cross-invariant checks (multi-currency on catalog.fiats enable); 5) repo.upsert; 6) audit config_change before->after; 7) publisher.publish()
}
// EffectiveSetting = { key; category; label; description; valueType; editable; value; source: 'db'|'env'|'json'; scope; scopeValue }
```
- [ ] Spec (mock repo + EffectiveConfigService + AuditService + publisher): update validates + upserts + audits `config_change` + publishes; non-editable key → `SettingNotEditableError`; out-of-range value → `SettingValidationError`; enabling a fiat with no limits/base-rate → `MultiCurrencyInvariantError`; `listEffective` excludes secret entries and reports the correct `source`. Implement.
- [ ] Controller: `GET /admin/settings?category=` (RequirePermission `api_route GET /admin/settings read` — add to catalog, category `Config`), `GET /admin/settings/:key` (read), `PATCH /admin/settings/:key` (write + `AdminStepUpGuard`). DTOs via `createZodDto`. Add the 3 catalog permissions (read/read/write) + web_page `/admin/settings` + menu `menu.config`; grant Config to finance(read)+ops(read), Pricing/Catalog/KYC write to finance/compliance per the role matrix.
- [ ] e2e (extend admin-rbac or new): super_admin PATCH `pricing.processingFeeBps` → effective value changes on a subsequent GET; a non-editable key → 409/422; ops GET allowed, PATCH 403. Commit `feat(api): admin settings service, controller, and registry-validated CRUD`.

## Task 4: migrate the 18 TODO(config-admin) consumers
**Files:** the ~10 consumer services + their specs; remove the `TODO(config-admin)` markers as each is wired.
- [ ] For each consumer reading a tunable section (`pricing`/`limits`/`buy`/`sell`/`swap`/`compliance`/`beneficiary`/`reconciliation`/`statement`/`catalog`), change the injected `ConfigService<AppConfig, true>` to `EffectiveConfigService` (same `get` calls). For EACH, first add/确认 a test asserting behavior is identical with no override, then the swap, then a test asserting an override flows through. Run that module's tests green before moving on.
- [ ] `kyc-gate.service`: limits now come from `EffectiveConfigService.get<LimitsConfig>('limits')` — add a test that a DB tier-limit override changes the gate decision. Remove the TODO block.
- [ ] Leave `auth.*` (PIN/JWT/OTP) on plain `ConfigService` (security-infra; registry marks non-editable). Remove the remaining `TODO(config-admin)` annotations in `configuration.ts`, replacing with a one-line "overridable via AppSetting/registry" note where true.
- [ ] Full api unit + the money-path e2e suites green; `depcruise` clean (EffectiveConfigService is `core/`, importable by application). Commit `refactor(api): read tunable config through EffectiveConfigService (wire AppSetting overrides)`.

## Task 5: web-admin config/pricing/catalog/KYC pages
**Files:** `web-admin/lib/api/settings.ts` + query hooks; `app/settings/`, `app/pricing/`, `app/catalog/`, `app/kyc/`; `components/admin/settings-*`.
- [ ] Settings client + `useSettings(category)` + `useUpdateSetting`. A generic `SettingsEditor` rendering each registry entry by `valueType` (number/string/boolean/string[]) with min/max/options validation, showing the **effective value + source layer badge** (db/env/json), step-up on save. 4 async branches.
- [ ] Specialized pages reuse the editor filtered by category: `settings` (Config + enablement flags as switches), `pricing` (spreads/fees/base-rates table per asset×currency — labelled "company margin, hidden from end users"), `catalog` (assets/fiats/networks enable toggles + provider-id fields, with the multi-currency invariant surfaced as an inline error from the API), `kyc` (tier limits/velocity/Travel-Rule thresholds). Nav gated by `menu.config`/`menu.pricing`/etc.
- [ ] Vitest: the editor renders a number field with min/max, calls update with the parsed value, shows the API validation error; the source-layer badge reflects `source`. typecheck/lint/test/build green. Commit `feat(web-admin): settings, pricing, catalog, and KYC config pages`.

## Task 6: §8 housekeeping + Phase-1 gate
- [ ] Promote `AdminSessionView` to `packages/contracts/src/admin/session.dto.ts`; have `admin-sessions.controller` parse responses through it and web-admin import it (drop the local schema). Test.
- [ ] Full gate: `pnpm typecheck`, `pnpm test`, `pnpm depcruise`; api e2e (admin-rbac + settings + a money-path suite) green. Verify a money-path value (e.g. a spread) overridden via the API actually changes a quote. Commit; update memory.

## Self-review notes
- Spec coverage: layered service (T2), registry+validation (T1,T3), CRUD+audit (T3), wire-all-18 (T4), pricing/catalog/KYC surfaces (T3 API via categories + T5 UI), multi-currency invariant (T3), secrets-never-shown/isEditable (T3). §8 session drift (T6).
- Money-path safety: T2 proves no-override == identical; T4 migrates per-consumer with a behavior-identical test first.
- Type consistency: `EffectiveConfigService.get<T>(key)` mirrors `ConfigService.get`; `AppSettingRow.value: unknown` narrowed by `settingSchemaFor` at the write boundary.
