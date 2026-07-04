# Web multi-language support (Google Translate) + mobile Settings — design

- **Date:** 2026-07-04
- **Branch:** `feat/web-multi-language`
- **Scope:** `web/` only (no `api/`, no `packages/contracts/` — this is client-only)
- **Status:** approved design, pending spec review

## 1. Goal

Add whole-app multi-language support to the user web app without hand-authoring
translations, by embedding Google Translate (`next-google-translate-widget`) as
the translation engine. Two user-facing behaviours:

1. **Auto-detect** the visitor's browser language on first visit and translate the
   app into it (when supported and non-English).
2. **Let the user pick** any language from Google's full supported list, in
   **Settings**. The explicit choice overrides detection and persists.

Bundled sub-requirement: **Settings must be reachable on mobile** — today the
mobile bottom bar shows only Chat / Wallet / Activity and there is no other way
to reach settings. Add a **Settings tab** to the mobile bottom bar.

## 2. Product decisions (locked in during brainstorming)

| Decision                    | Choice                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Mobile settings entry point | **Add a Settings tab** (4th bottom-bar item, gear icon)                                                            |
| Language list               | **Full Google supported list (~100+)**, searchable                                                                 |
| Translation scope           | **Whole app** (landing + auth + signed-in surfaces), wired at the root layout                                      |
| Persistence                 | **Client-only** (`googtrans` cookie is source of truth; `ha.lang` localStorage mirror). No backend/contract field. |
| Shared settings body        | **Extract** a shared `settings-panel` so mobile reuses desktop's settings body (no fork)                           |
| Money-node safety           | Mark amounts / wallet addresses / references / PIN with `translate="no"`                                           |

## 3. Current state (verified)

- **No i18n exists.** `next-google-translate-widget` is not installed. No
  `next-intl` / `react-i18next` / `intl`.
- `web/lib/constants.ts` has a Nigeria-only, hardcoded `LANGUAGES = ["English",
"Pidgin", "Hausa", "Yoruba", "Igbo"]` used **only** by the desktop settings
  page. Note: **Google Translate has no "Nigerian Pidgin"** target, so that pill
  can never drive real translation.
- `web/components/desktop/settings-page.tsx` renders a Language section whose
  pills are pure `useState<Language>("English")` — they persist nothing and
  translate nothing (dead UI).
- **Mobile has no settings access.** `/app` → `MobileShell` (`web/components/
mobile/mobile-shell.tsx`) renders tabs from local state (`chat`/`wallet`/
  `activity`); `MobileTabbar` (`web/components/mobile/mobile-tabbar.tsx`) lists
  only those three. There is **no persistent mobile header** (`ChatHeader` shows
  only on the chat tab).
- Desktop reaches settings via `DashboardSidebar` → client state `dPage ===
"settings"` → `<SettingsPage />` (in `web/components/desktop/`).
- Root layout `web/app/layout.tsx` hardcodes `<html lang="en">`; global
  providers are composed in `web/components/providers.tsx` (`ThemeProvider` →
  `QueryClientProvider` → `AuthProvider`).
- **CSP will not block the Google script.** `web/next.config.ts` ships only
  `Content-Security-Policy: frame-ancestors 'none'` plus baseline hardening
  headers — no `script-src`/`default-src` restriction.

## 4. Approach

The translation engine (Google Translate) is fixed by the package choice. The
integration pattern is **settings-driven with a hidden engine**:

- Use the widget/script only to **bootstrap** Google's translate engine (inject
  its script + a hidden mount element with `{ pageLanguage: "en",
autoDisplay: false }`).
- **Hide** Google's default banner/dropdown via CSS.
- Drive every language change **ourselves** from our own `LanguageSelector`, via:
  1. writing the `googtrans` cookie (`/{source}/{target}`) — this is what makes
     Google auto-translate on the next page load, and
  2. setting the value of the engine's hidden `<select class="goog-te-combo">`
     and dispatching a `change` event — this switches the **current** page
     instantly, no full reload.

**Design intent: wrapper-agnostic.** We depend on the wrapper only to inject the
script and hidden element. All control (cookie + combo) is ours. If the installed
`next-google-translate-widget` API does not expose what we need, we inject the
script directly in `google-translate.ts` — the rest of the design is unchanged.
The exact wrapper component/props will be verified against the installed package
during implementation.

Rejected alternatives:

- **Google's default floating dropdown** — doesn't live in Settings, unstyleable,
  shows the banner.
- **Real i18n (next-intl + translation files)** — higher fidelity but
  reintroduces the manual translation this feature exists to avoid.

## 5. Architecture (respects `web/` strict downward layering: `app → components → lib → types`)

### 5.1 `lib/i18n/` — the only layer touching cookies / localStorage / navigator

- **`languages.ts`** — `SUPPORTED_LANGUAGES: readonly Language[]` where
  `Language = { code: string; englishName: string; nativeName: string }`, covering
  Google Translate's supported set (~100+). `DEFAULT_LANGUAGE_CODE = "en"`.
  Helper `findLanguage(code): Language | undefined`. This **supersedes** the
  Nigeria-only `LANGUAGES` const in `lib/constants.ts`.
- **`browser-language.ts`** — `detectBrowserLanguage(navigatorLanguages: readonly
string[], supported: readonly Language[]): string`. Maps each `navigator.language`
  entry (`"fr-CA"`, `"pt-BR"`, `"zh-Hans"`, …) to the best supported code, falling
  back to `DEFAULT_LANGUAGE_CODE`. Pure; heavily unit-tested.
- **`translate-cookie.ts`** — `googtrans` cookie read/write in `/{source}/{target}`
  form + `ha.lang` localStorage mirror. Exposes `getActiveLanguageCode()`,
  `setActiveLanguageCode(code)`, `clearActiveLanguage()`. Writes the cookie for
  both bare-host and dotted-domain variants (`googtrans` domain quirk). Pure-ish;
  tested against a mocked `document.cookie`.
- **`google-translate.ts`** — engine bootstrap + control:
  - `bootstrapGoogleTranslate()` — idempotently defines
    `window.googleTranslateElementInit` (config `{ pageLanguage: "en",
autoDisplay: false }`), ensures the hidden `#google_translate_element`
    mount exists, and injects the script once.
  - `applyLanguageToLivePage(code)` — sets the `.goog-te-combo` select value +
    dispatches `change`; retries briefly until the combo exists (engine is async);
    falls back to a cookie-set + reload if the combo never appears.
  - `installReactSafetyPatch()` — the documented `Node.prototype.removeChild` /
    `insertBefore` guard that prevents the well-known **Google-Translate-crashes-
    React** `NotFoundError` on navigation/unmount.

### 5.2 `components/` — UI

- **`shared/translation-provider.tsx`** — `"use client"` provider mounted inside
  `components/providers.tsx` (inside `AuthProvider`, so it wraps the whole app).
  On mount: `installReactSafetyPatch()` → `bootstrapGoogleTranslate()` → resolve
  the initial language (stored choice, else `detectBrowserLanguage`) → apply it
  once. Injects a `<style>` (or globals.css rule) hiding Google chrome
  (`.skiptranslate` banner, `body { top: 0 !important }`, `#goog-gt-tt` tooltip).
  Exposes context `{ language: Language, setLanguage(code), languages }`.
- **`hooks/use-translation.ts`** — `useTranslation()` reads the context; throws a
  clear error if used outside the provider.
- **`shared/language-selector.tsx`** — searchable combobox (shadcn `Command` +
  `Popover`) over `SUPPORTED_LANGUAGES`, matching on native **or** English name;
  shows `nativeName` with `englishName` secondary. Selecting calls
  `setLanguage(code)`. Includes an explicit **"English (original)"** reset that
  calls `clearActiveLanguage()`. One canonical control, used by both settings
  surfaces. Its own trigger/label is marked `translate="no"` so Google doesn't
  mangle language names.

### 5.3 Shared settings body (de-fork)

- Extract the settings body from `web/components/desktop/settings-page.tsx` into
  **`components/settings/settings-panel.tsx`** (profile card / security / language
  / daily-limit / logout), density-aware (`density?: "desktop" | "mobile"`).
- `desktop/settings-page.tsx` becomes a thin wrapper: `<SettingsPanel />` with
  desktop padding.
- The Language section inside `SettingsPanel` **replaces the dead pills** with
  `<LanguageSelector />`.

### 5.4 Mobile Settings tab

- `types/components.ts`: extend `MobileTabId` with `"settings"`.
- `mobile-tabbar.tsx`: add a `GearIcon` and a 4th `TABS` entry
  `{ id: "settings", label: "Settings", Icon: GearIcon }`. (Bottom bar goes 3 → 4
  tabs; `flex-1` already distributes width.)
- `mobile-shell.tsx`: render `<SettingsPanel density="mobile" />` when
  `tab === "settings"`.

### 5.5 Money-node safety (`§3.1` safety-of-funds)

Google Translate rewrites all text nodes, which for a custodial money app could
reword/reformat amounts, addresses, or reference IDs. Mark the critical nodes
`translate="no"` (Google honours it), specifically:

- Confirmation sheet line-items and totals (`components/chat/overlays/confirm-sheet.tsx`).
- PIN pad (`components/chat/overlays/pin-pad.tsx`).
- Wallet addresses and transaction reference/tracking IDs wherever rendered.
- Money-amount display components (the `formatFiatAmount` / amount render sites).

The user still sees translated _labels_ around them, but the authorized numbers,
addresses, and refs are never altered by the translator.

## 6. Detection & persistence precedence

1. **First visit, nothing stored:** `detectBrowserLanguage(navigator.languages)`
   → if a supported non-English match, set cookie + `ha.lang` and apply (page
   loads/renders translated); otherwise stay original English.
2. **Explicit choice always wins** and persists. Cookie is the source of truth
   (Google reads it on load); `ha.lang` mirrors it for instant selector display.
3. **"English (original)"** clears the cookie + mirror → back to source text.
4. No backend field — client-only. (There is no contract for user language today;
   YAGNI. If cross-device sync is wanted later, add a `preferredLanguage` field to
   the profile contract + `PATCH /profile` — out of scope here.)

## 7. Testing (strict TDD — Vitest + Playwright)

The Google script cannot run under jsdom, so we mock it and assert **our seams**.

Unit (Vitest, red-first):

- `browser-language.ts` — a table of `navigator.language(s)` inputs → expected
  code (region stripping, script variants, unsupported → `en`, empty → `en`).
- `translate-cookie.ts` — write sets `googtrans` in `/{src}/{tgt}` form + mirror;
  read parses it; clear removes both; precedence (stored beats detected).
- `languages.ts` — codes unique, non-empty, `en` present; every entry has native
  - English names.
- `language-selector.tsx` — renders, filters on native/English name, calls
  `setLanguage` with the chosen code, "English (original)" calls clear.
- `translation-provider.tsx` — on mount applies stored code if present, else the
  detected code, with `bootstrapGoogleTranslate`/`applyLanguageToLivePage` mocked;
  asserts the safety patch is installed once.
- `mobile-tabbar.tsx` — now renders 4 tabs incl. "Settings"; selecting it calls
  `onSelect("settings")`.
- `settings-panel.tsx` — renders the `LanguageSelector`; desktop wrapper + mobile
  tab both mount it.
- `mobile-shell.tsx` — `tab === "settings"` renders the settings panel.

E2E (Playwright, light — real Google script network is flaky in CI, stub/allow as
needed): Settings → open language selector → pick a language → assert the
`googtrans` cookie is set and the choice survives a reload.

## 8. Known limitations (documented, accepted)

- **React + Google Translate fragility** — mitigated by the `removeChild`/
  `insertBefore` patch, not eliminated. This is inherent to running Google
  Translate over a React tree.
- **Streaming agent replies** re-translate per token and settle once the message
  completes (minor flicker on streaming bubbles).
- **Hiding Google's banner** is a minor ToS gray area — standard practice,
  accepted. Our own selector remains the visible control.
- **Third-party script on the whole app** (incl. public marketing) — loads
  client-side only; acceptable per the whole-app scope decision.

## 9. Out of scope

- Backend/contract changes; cross-device language sync.
- Translating WhatsApp or `api/` responses (this is a `web/` UI feature).
- Replacing Google Translate with real i18n resource files.
- Translating the separate `web-admin/` console.

## 10. New dependencies

- `next-google-translate-widget` (runtime, `web`).
- shadcn `command` + `popover` primitives (if not already present) for the
  searchable selector.

## 11. Files touched (anticipated)

New:

- `web/lib/i18n/languages.ts`, `browser-language.ts`, `translate-cookie.ts`, `google-translate.ts`
- `web/components/shared/translation-provider.tsx`, `web/components/shared/language-selector.tsx`
- `web/hooks/use-translation.ts`
- `web/components/settings/settings-panel.tsx`
- tests colocated per existing convention

Modified:

- `web/components/providers.tsx` (mount `TranslationProvider`)
- `web/components/desktop/settings-page.tsx` (thin wrapper over `SettingsPanel`)
- `web/components/mobile/mobile-tabbar.tsx` (Settings tab + gear icon)
- `web/components/mobile/mobile-shell.tsx` (render settings panel)
- `web/types/components.ts` (`MobileTabId` += `"settings"`)
- `web/lib/constants.ts` (remove/repoint the dead `LANGUAGES`)
- confirm-sheet / pin-pad / amount / address / ref render sites (`translate="no"`)
- `web/package.json` (deps)
