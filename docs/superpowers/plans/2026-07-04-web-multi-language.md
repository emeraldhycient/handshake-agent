# Web Multi-Language (Google Translate) + Mobile Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the user web app whole-app multi-language support via Google Translate (auto-detect browser language, and let the user pick any language from Google's full list in Settings), and make Settings reachable on mobile via a new bottom-bar tab.

**Architecture:** A client-only translation layer. `lib/i18n/` owns all world-facing state (the `googtrans` cookie, `localStorage`, `navigator.language`, and the Google engine controls). A `TranslationProvider` (mounted app-wide in `components/providers.tsx`) mounts the `next-google-translate-widget` engine hidden, installs the React-safety DOM patch, and applies the stored-or-detected language on mount. A shared `LanguageSelector` (built on the codebase's existing combobox pattern) drives language changes from a shared `SettingsPanel` used by both the desktop settings page and a new mobile Settings tab. Money-critical nodes (amounts, addresses, refs) are marked `translate="no"` so the translator never rewrites values a user authorizes.

**Tech Stack:** Next.js 16 / React 19, TypeScript, Tailwind v4 (CSS-first), Vitest + React Testing Library + `@testing-library/user-event`, Playwright (e2e), `next-google-translate-widget`.

## Global Constraints

- **Package manager / scope:** all commands run from repo root as `pnpm --filter @handshake-agent/web <script>`. Node LTS (`^20.12 || ^22 || >=24`).
- **Strict downward layering** (`app → components → lib → types`), enforced by `dependency-cruiser`. `components/` must NOT import from `app/`; `lib/` must NOT import from `components/`. **Components are pure UI — no `fetch`, no `localStorage`, no `document.cookie`, no `navigator`.** All cookie/localStorage/navigator/DOM-engine access lives in `lib/i18n/`.
- **Types are centralized** in `web/types/` as `XxxProps` (root §13.4). No inline prop types.
- **Tokens only — no hex literals** in components (root §13.1). Use `cn()` from `@/lib/utils`.
- **Every async UI has four branches:** loading / error / empty / data.
- **TDD, red → green → refactor.** Tests are colocated as `*.test.ts(x)` next to the file. Run with `pnpm --filter @handshake-agent/web test`.
- **Persistence is client-only.** No `api/` or `packages/contracts/` changes. Source of truth is the `googtrans` cookie; `ha.lang` in `localStorage` mirrors it for instant display.
- **Money-node safety (root §3.1):** amounts, wallet addresses, and transaction references/hashes must carry `translate="no"` so Google Translate cannot reformat them.
- **Conventional Commits**, one coherent change per commit (`feat(web): …`, `test(web): …`, `refactor(web): …`, `chore(web): …`).
- **Google Translate legacy codes** the `.goog-te-combo` expects: Hebrew = `iw` (not `he`), Javanese = `jw` (not `jv`), Filipino = `tl`, Chinese = `zh-CN` / `zh-TW`. Detection must map browser aliases (`he→iw`, `jv→jw`, `fil→tl`, `in→id`, `nb/nn→no`, `zh*→zh-CN|zh-TW`) to these.

---

## File structure

New (`web/`):

- `lib/i18n/languages.ts` (+ `.test.ts`) — `SUPPORTED_LANGUAGES`, `DEFAULT_LANGUAGE_CODE`, `findLanguage`.
- `lib/i18n/browser-language.ts` (+ `.test.ts`) — `detectBrowserLanguage`.
- `lib/i18n/translate-cookie.ts` (+ `.test.ts`) — `googtrans` cookie + `ha.lang` mirror read/write.
- `lib/i18n/google-translate.ts` (+ `.test.ts`) — `installReactSafetyPatch`, `applyLanguageToLivePage`, `resetToOriginal`, `findTranslateCombo`.
- `components/shared/translation-provider.tsx` (+ `.test.tsx`) — provider + `useTranslation` + hidden engine mount + initial apply.
- `components/shared/language-selector.tsx` (+ `.test.tsx`) — searchable combobox.
- `components/settings/settings-panel.tsx` (+ `.test.tsx`) — shared settings body.
- `e2e/language.spec.ts` — Playwright, Google script stubbed.

Modified (`web/`):

- `components/providers.tsx` — mount `TranslationProvider` (innermost).
- `components/desktop/settings-page.tsx` — thin wrapper over `<SettingsPanel />`.
- `components/mobile/mobile-tabbar.tsx` — add gear icon + Settings tab.
- `components/mobile/mobile-shell.tsx` — render `<SettingsPanel density="mobile" />` on the settings tab.
- `types/components.ts` — `MobileTabId += "settings"`; add `SettingsPanelProps`, `LanguageSelectorProps`.
- `lib/constants.ts` — remove the dead `LANGUAGES` const.
- `components/shared/money.tsx`, `components/shared/detail-rows.tsx` — `translate="no"` on the value span.
- `components/chat/cards/receive-card.tsx`, `components/chat/cards/receipt-card.tsx`, `components/shared/transaction-detail-modal.tsx` — `translate="no"` on raw address/ref/hash spans.
- `app/globals.css` — CSS to hide Google's banner/tooltip and reset the injected `body { top }`.
- `web/package.json` — add `next-google-translate-widget`.

---

### Task 1: Install the package + language data (`lib/i18n/languages.ts`)

**Files:**

- Modify: `web/package.json` (dependency)
- Create: `web/lib/i18n/languages.ts`
- Test: `web/lib/i18n/languages.test.ts`

**Interfaces:**

- Produces: `type Language = { code: string; englishName: string; nativeName: string }`; `SUPPORTED_LANGUAGES: readonly Language[]`; `DEFAULT_LANGUAGE_CODE = "en"`; `findLanguage(code: string): Language | undefined`.

- [ ] **Step 1: Install the package**

Run:

```bash
pnpm --filter @handshake-agent/web add next-google-translate-widget
```

- [ ] **Step 2: Confirm the package's actual API (informs Task 5)**

Run:

```bash
ls web/node_modules/next-google-translate-widget/dist 2>/dev/null || ls web/node_modules/next-google-translate-widget
grep -RilE "TranslateElement|goog-te-combo|googtrans|translate_a/element" web/node_modules/next-google-translate-widget || echo "no direct google refs found"
```

Note the default export name (expected `GoogleTranslate`) and whether it references `TranslateElement`/`googtrans`. This only informs expectations — Task 4/5 work whether or not it exposes `.goog-te-combo` (cookie + reload is the reliable fallback). Record findings in the Task 5 commit message.

- [ ] **Step 3: Write the failing test**

```typescript
// web/lib/i18n/languages.test.ts
import { describe, expect, it } from "vitest";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE_CODE,
  findLanguage,
} from "./languages";

describe("SUPPORTED_LANGUAGES", () => {
  it("includes English as the default", () => {
    expect(DEFAULT_LANGUAGE_CODE).toBe("en");
    expect(SUPPORTED_LANGUAGES.some((l) => l.code === "en")).toBe(true);
  });

  it("has at least 100 languages (the 'full Google list')", () => {
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(100);
  });

  it("has unique, non-empty codes and names for every entry", () => {
    const codes = new Set<string>();
    for (const l of SUPPORTED_LANGUAGES) {
      expect(l.code.trim()).not.toBe("");
      expect(l.englishName.trim()).not.toBe("");
      expect(l.nativeName.trim()).not.toBe("");
      expect(codes.has(l.code)).toBe(false);
      codes.add(l.code);
    }
  });

  it("uses the Google widget legacy codes (iw, jw, tl, zh-CN, zh-TW)", () => {
    for (const code of ["iw", "jw", "tl", "zh-CN", "zh-TW"]) {
      expect(SUPPORTED_LANGUAGES.some((l) => l.code === code)).toBe(true);
    }
    // Guard against the modern aliases sneaking in as duplicates.
    expect(SUPPORTED_LANGUAGES.some((l) => l.code === "he")).toBe(false);
    expect(SUPPORTED_LANGUAGES.some((l) => l.code === "jv")).toBe(false);
  });

  it("findLanguage returns the entry or undefined", () => {
    expect(findLanguage("fr")?.englishName).toBe("French");
    expect(findLanguage("zz-NOPE")).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run it and verify it fails**

Run: `pnpm --filter @handshake-agent/web test lib/i18n/languages.test.ts`
Expected: FAIL — "Failed to resolve import ./languages".

- [ ] **Step 5: Implement the data file**

```typescript
// web/lib/i18n/languages.ts
/**
 * The languages the app offers for translation. Codes are the values Google
 * Translate's embedded widget (`.goog-te-combo`) expects — note the legacy
 * codes: Hebrew `iw`, Javanese `jw`, Filipino `tl`, Chinese `zh-CN`/`zh-TW`.
 * `englishName`/`nativeName` are display-only; `code` is what drives translation.
 */
export type Language = {
  code: string;
  englishName: string;
  nativeName: string;
};

export const DEFAULT_LANGUAGE_CODE = "en";

export const SUPPORTED_LANGUAGES: readonly Language[] = [
  { code: "en", englishName: "English", nativeName: "English" },
  { code: "af", englishName: "Afrikaans", nativeName: "Afrikaans" },
  { code: "sq", englishName: "Albanian", nativeName: "Shqip" },
  { code: "am", englishName: "Amharic", nativeName: "አማርኛ" },
  { code: "ar", englishName: "Arabic", nativeName: "العربية" },
  { code: "hy", englishName: "Armenian", nativeName: "Հայերեն" },
  { code: "az", englishName: "Azerbaijani", nativeName: "Azərbaycan" },
  { code: "eu", englishName: "Basque", nativeName: "Euskara" },
  { code: "be", englishName: "Belarusian", nativeName: "Беларуская" },
  { code: "bn", englishName: "Bengali", nativeName: "বাংলা" },
  { code: "bs", englishName: "Bosnian", nativeName: "Bosanski" },
  { code: "bg", englishName: "Bulgarian", nativeName: "Български" },
  { code: "ca", englishName: "Catalan", nativeName: "Català" },
  { code: "ceb", englishName: "Cebuano", nativeName: "Cebuano" },
  { code: "ny", englishName: "Chichewa", nativeName: "Chichewa" },
  {
    code: "zh-CN",
    englishName: "Chinese (Simplified)",
    nativeName: "简体中文",
  },
  {
    code: "zh-TW",
    englishName: "Chinese (Traditional)",
    nativeName: "繁體中文",
  },
  { code: "co", englishName: "Corsican", nativeName: "Corsu" },
  { code: "hr", englishName: "Croatian", nativeName: "Hrvatski" },
  { code: "cs", englishName: "Czech", nativeName: "Čeština" },
  { code: "da", englishName: "Danish", nativeName: "Dansk" },
  { code: "nl", englishName: "Dutch", nativeName: "Nederlands" },
  { code: "eo", englishName: "Esperanto", nativeName: "Esperanto" },
  { code: "et", englishName: "Estonian", nativeName: "Eesti" },
  { code: "tl", englishName: "Filipino", nativeName: "Filipino" },
  { code: "fi", englishName: "Finnish", nativeName: "Suomi" },
  { code: "fr", englishName: "French", nativeName: "Français" },
  { code: "fy", englishName: "Frisian", nativeName: "Frysk" },
  { code: "gl", englishName: "Galician", nativeName: "Galego" },
  { code: "ka", englishName: "Georgian", nativeName: "ქართული" },
  { code: "de", englishName: "German", nativeName: "Deutsch" },
  { code: "el", englishName: "Greek", nativeName: "Ελληνικά" },
  { code: "gu", englishName: "Gujarati", nativeName: "ગુજરાતી" },
  { code: "ht", englishName: "Haitian Creole", nativeName: "Kreyòl Ayisyen" },
  { code: "ha", englishName: "Hausa", nativeName: "Hausa" },
  { code: "haw", englishName: "Hawaiian", nativeName: "ʻŌlelo Hawaiʻi" },
  { code: "iw", englishName: "Hebrew", nativeName: "עברית" },
  { code: "hi", englishName: "Hindi", nativeName: "हिन्दी" },
  { code: "hmn", englishName: "Hmong", nativeName: "Hmoob" },
  { code: "hu", englishName: "Hungarian", nativeName: "Magyar" },
  { code: "is", englishName: "Icelandic", nativeName: "Íslenska" },
  { code: "ig", englishName: "Igbo", nativeName: "Igbo" },
  { code: "id", englishName: "Indonesian", nativeName: "Indonesia" },
  { code: "ga", englishName: "Irish", nativeName: "Gaeilge" },
  { code: "it", englishName: "Italian", nativeName: "Italiano" },
  { code: "ja", englishName: "Japanese", nativeName: "日本語" },
  { code: "jw", englishName: "Javanese", nativeName: "Basa Jawa" },
  { code: "kn", englishName: "Kannada", nativeName: "ಕನ್ನಡ" },
  { code: "kk", englishName: "Kazakh", nativeName: "Қазақ" },
  { code: "km", englishName: "Khmer", nativeName: "ខ្មែរ" },
  { code: "rw", englishName: "Kinyarwanda", nativeName: "Kinyarwanda" },
  { code: "ko", englishName: "Korean", nativeName: "한국어" },
  { code: "ku", englishName: "Kurdish (Kurmanji)", nativeName: "Kurdî" },
  { code: "ky", englishName: "Kyrgyz", nativeName: "Кыргызча" },
  { code: "lo", englishName: "Lao", nativeName: "ລາວ" },
  { code: "la", englishName: "Latin", nativeName: "Latina" },
  { code: "lv", englishName: "Latvian", nativeName: "Latviešu" },
  { code: "lt", englishName: "Lithuanian", nativeName: "Lietuvių" },
  { code: "lb", englishName: "Luxembourgish", nativeName: "Lëtzebuergesch" },
  { code: "mk", englishName: "Macedonian", nativeName: "Македонски" },
  { code: "mg", englishName: "Malagasy", nativeName: "Malagasy" },
  { code: "ms", englishName: "Malay", nativeName: "Melayu" },
  { code: "ml", englishName: "Malayalam", nativeName: "മലയാളം" },
  { code: "mt", englishName: "Maltese", nativeName: "Malti" },
  { code: "mi", englishName: "Maori", nativeName: "Māori" },
  { code: "mr", englishName: "Marathi", nativeName: "मराठी" },
  { code: "mn", englishName: "Mongolian", nativeName: "Монгол" },
  { code: "my", englishName: "Myanmar (Burmese)", nativeName: "မြန်မာ" },
  { code: "ne", englishName: "Nepali", nativeName: "नेपाली" },
  { code: "no", englishName: "Norwegian", nativeName: "Norsk" },
  { code: "or", englishName: "Odia (Oriya)", nativeName: "ଓଡ଼ିଆ" },
  { code: "ps", englishName: "Pashto", nativeName: "پښتو" },
  { code: "fa", englishName: "Persian", nativeName: "فارسی" },
  { code: "pl", englishName: "Polish", nativeName: "Polski" },
  { code: "pt", englishName: "Portuguese", nativeName: "Português" },
  { code: "pa", englishName: "Punjabi", nativeName: "ਪੰਜਾਬੀ" },
  { code: "ro", englishName: "Romanian", nativeName: "Română" },
  { code: "ru", englishName: "Russian", nativeName: "Русский" },
  { code: "sm", englishName: "Samoan", nativeName: "Gagana Samoa" },
  { code: "gd", englishName: "Scots Gaelic", nativeName: "Gàidhlig" },
  { code: "sr", englishName: "Serbian", nativeName: "Српски" },
  { code: "st", englishName: "Sesotho", nativeName: "Sesotho" },
  { code: "sn", englishName: "Shona", nativeName: "Shona" },
  { code: "sd", englishName: "Sindhi", nativeName: "سنڌي" },
  { code: "si", englishName: "Sinhala", nativeName: "සිංහල" },
  { code: "sk", englishName: "Slovak", nativeName: "Slovenčina" },
  { code: "sl", englishName: "Slovenian", nativeName: "Slovenščina" },
  { code: "so", englishName: "Somali", nativeName: "Soomaali" },
  { code: "es", englishName: "Spanish", nativeName: "Español" },
  { code: "su", englishName: "Sundanese", nativeName: "Basa Sunda" },
  { code: "sw", englishName: "Swahili", nativeName: "Kiswahili" },
  { code: "sv", englishName: "Swedish", nativeName: "Svenska" },
  { code: "tg", englishName: "Tajik", nativeName: "Тоҷикӣ" },
  { code: "ta", englishName: "Tamil", nativeName: "தமிழ்" },
  { code: "tt", englishName: "Tatar", nativeName: "Татар" },
  { code: "te", englishName: "Telugu", nativeName: "తెలుగు" },
  { code: "th", englishName: "Thai", nativeName: "ไทย" },
  { code: "tr", englishName: "Turkish", nativeName: "Türkçe" },
  { code: "tk", englishName: "Turkmen", nativeName: "Türkmen" },
  { code: "uk", englishName: "Ukrainian", nativeName: "Українська" },
  { code: "ur", englishName: "Urdu", nativeName: "اردو" },
  { code: "ug", englishName: "Uyghur", nativeName: "ئۇيغۇرچە" },
  { code: "uz", englishName: "Uzbek", nativeName: "Oʻzbek" },
  { code: "vi", englishName: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "cy", englishName: "Welsh", nativeName: "Cymraeg" },
  { code: "xh", englishName: "Xhosa", nativeName: "isiXhosa" },
  { code: "yi", englishName: "Yiddish", nativeName: "ייִדיש" },
  { code: "yo", englishName: "Yoruba", nativeName: "Yorùbá" },
  { code: "zu", englishName: "Zulu", nativeName: "isiZulu" },
];

const BY_CODE = new Map(SUPPORTED_LANGUAGES.map((l) => [l.code, l]));

export function findLanguage(code: string): Language | undefined {
  return BY_CODE.get(code);
}
```

- [ ] **Step 6: Run it and verify it passes**

Run: `pnpm --filter @handshake-agent/web test lib/i18n/languages.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add web/lib/i18n/languages.ts web/lib/i18n/languages.test.ts web/package.json ../pnpm-lock.yaml
git commit -m "feat(web): add supported-languages data + install next-google-translate-widget"
```

---

### Task 2: Browser-language detection (`lib/i18n/browser-language.ts`)

**Files:**

- Create: `web/lib/i18n/browser-language.ts`
- Test: `web/lib/i18n/browser-language.test.ts`

**Interfaces:**

- Consumes: `SUPPORTED_LANGUAGES`, `DEFAULT_LANGUAGE_CODE` from `./languages`.
- Produces: `detectBrowserLanguage(navigatorLanguages: readonly string[]): string` — returns a supported code, else `DEFAULT_LANGUAGE_CODE`.

- [ ] **Step 1: Write the failing test**

```typescript
// web/lib/i18n/browser-language.test.ts
import { describe, expect, it } from "vitest";
import { detectBrowserLanguage } from "./browser-language";

describe("detectBrowserLanguage", () => {
  it("matches an exact supported code", () => {
    expect(detectBrowserLanguage(["fr"])).toBe("fr");
  });

  it("strips the region subtag (pt-BR -> pt)", () => {
    expect(detectBrowserLanguage(["pt-BR"])).toBe("pt");
    expect(detectBrowserLanguage(["fr-CA"])).toBe("fr");
  });

  it("maps browser aliases to Google's legacy codes", () => {
    expect(detectBrowserLanguage(["he-IL"])).toBe("iw"); // Hebrew
    expect(detectBrowserLanguage(["jv"])).toBe("jw"); // Javanese
    expect(detectBrowserLanguage(["fil"])).toBe("tl"); // Filipino
    expect(detectBrowserLanguage(["in"])).toBe("id"); // legacy Indonesian
    expect(detectBrowserLanguage(["nb-NO"])).toBe("no"); // Norwegian Bokmål
  });

  it("resolves Chinese variants", () => {
    expect(detectBrowserLanguage(["zh-TW"])).toBe("zh-TW");
    expect(detectBrowserLanguage(["zh-Hant-HK"])).toBe("zh-TW");
    expect(detectBrowserLanguage(["zh-CN"])).toBe("zh-CN");
    expect(detectBrowserLanguage(["zh"])).toBe("zh-CN");
  });

  it("prefers the first supported entry in the preference list", () => {
    expect(detectBrowserLanguage(["zz", "de", "fr"])).toBe("de");
  });

  it("falls back to English for unsupported or empty input", () => {
    expect(detectBrowserLanguage(["zz-ZZ"])).toBe("en");
    expect(detectBrowserLanguage([])).toBe("en");
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm --filter @handshake-agent/web test lib/i18n/browser-language.test.ts`
Expected: FAIL — import cannot resolve.

- [ ] **Step 3: Implement**

```typescript
// web/lib/i18n/browser-language.ts
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE_CODE } from "./languages";

const SUPPORTED = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));

// Browser subtag / legacy alias -> Google widget code.
const ALIASES: Record<string, string> = {
  he: "iw",
  jv: "jw",
  fil: "tl",
  in: "id",
  nb: "no",
  nn: "no",
};

function resolveOne(raw: string): string | null {
  const tag = raw.trim().toLowerCase();
  if (!tag) return null;

  // Chinese needs script/region inspection before generic handling.
  if (tag.startsWith("zh")) {
    if (/(tw|hk|hant|mo)/.test(tag)) return "zh-TW";
    return "zh-CN";
  }

  const base = tag.split("-")[0];
  const aliased = ALIASES[base] ?? base;

  // Case-insensitive match against the supported set (which is lower-ish, but
  // codes like `zh-CN` are handled above, so remaining codes are lowercase).
  if (SUPPORTED.has(aliased)) return aliased;
  return null;
}

export function detectBrowserLanguage(
  navigatorLanguages: readonly string[],
): string {
  for (const raw of navigatorLanguages) {
    const match = resolveOne(raw);
    if (match) return match;
  }
  return DEFAULT_LANGUAGE_CODE;
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `pnpm --filter @handshake-agent/web test lib/i18n/browser-language.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/i18n/browser-language.ts web/lib/i18n/browser-language.test.ts
git commit -m "feat(web): map navigator languages to supported Google Translate codes"
```

---

### Task 3: Cookie + localStorage persistence (`lib/i18n/translate-cookie.ts`)

**Files:**

- Create: `web/lib/i18n/translate-cookie.ts`
- Test: `web/lib/i18n/translate-cookie.test.ts`

**Interfaces:**

- Consumes: `DEFAULT_LANGUAGE_CODE` from `./languages`.
- Produces:
  - `LANG_STORAGE_KEY = "ha.lang"`, `GOOGTRANS_COOKIE = "googtrans"`
  - `setActiveLanguageCode(code: string): void` — writes `googtrans=/en/<code>` (bare + `.host`) and mirrors to `localStorage`.
  - `clearActiveLanguage(): void` — removes both cookie variants + the mirror.
  - `getActiveLanguageCode(): string | null` — mirror first, else parses the cookie target, else `null`.

- [ ] **Step 1: Write the failing test**

```typescript
// web/lib/i18n/translate-cookie.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import {
  setActiveLanguageCode,
  clearActiveLanguage,
  getActiveLanguageCode,
  GOOGTRANS_COOKIE,
  LANG_STORAGE_KEY,
} from "./translate-cookie";

function clearCookies() {
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=;max-age=0;path=/`;
  }
}

describe("translate-cookie", () => {
  beforeEach(() => {
    clearCookies();
    localStorage.clear();
  });

  it("writes the googtrans cookie as /en/<code> and mirrors to localStorage", () => {
    setActiveLanguageCode("fr");
    expect(document.cookie).toContain(`${GOOGTRANS_COOKIE}=/en/fr`);
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe("fr");
  });

  it("reads the mirror first", () => {
    localStorage.setItem(LANG_STORAGE_KEY, "de");
    expect(getActiveLanguageCode()).toBe("de");
  });

  it("falls back to parsing the cookie target when no mirror", () => {
    localStorage.clear();
    document.cookie = `${GOOGTRANS_COOKIE}=/en/es;path=/`;
    expect(getActiveLanguageCode()).toBe("es");
  });

  it("returns null when nothing is set", () => {
    expect(getActiveLanguageCode()).toBeNull();
  });

  it("clear removes the cookie and the mirror", () => {
    setActiveLanguageCode("fr");
    clearActiveLanguage();
    expect(document.cookie).not.toContain(`${GOOGTRANS_COOKIE}=/en/fr`);
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBeNull();
    expect(getActiveLanguageCode()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm --filter @handshake-agent/web test lib/i18n/translate-cookie.test.ts`
Expected: FAIL — import cannot resolve.

- [ ] **Step 3: Implement**

```typescript
// web/lib/i18n/translate-cookie.ts
import { DEFAULT_LANGUAGE_CODE } from "./languages";

export const GOOGTRANS_COOKIE = "googtrans";
export const LANG_STORAGE_KEY = "ha.lang";

/** Source page language — everything translates FROM English. */
const SOURCE = DEFAULT_LANGUAGE_CODE;

function writeCookie(value: string, maxAgeSeconds: number): void {
  if (typeof document === "undefined") return;
  const base = `${GOOGTRANS_COOKIE}=${value};path=/;max-age=${maxAgeSeconds};samesite=lax`;
  document.cookie = base;
  // Google reads the cookie on the registrable domain; set a dotted-host
  // variant too when the hostname has a dot (skips `localhost`).
  const host = window.location.hostname;
  if (host.includes(".")) {
    document.cookie = `${base};domain=.${host}`;
  }
}

export function setActiveLanguageCode(code: string): void {
  // One year.
  writeCookie(`/${SOURCE}/${code}`, 60 * 60 * 24 * 365);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(LANG_STORAGE_KEY, code);
  }
}

export function clearActiveLanguage(): void {
  writeCookie("", 0);
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(LANG_STORAGE_KEY);
  }
}

function parseCookieTarget(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${GOOGTRANS_COOKIE}=`));
  if (!match) return null;
  // value is `/en/<target>`
  const value = decodeURIComponent(match.slice(GOOGTRANS_COOKIE.length + 1));
  const target = value.split("/")[2];
  return target && target.length > 0 ? target : null;
}

export function getActiveLanguageCode(): string | null {
  if (typeof localStorage !== "undefined") {
    const mirrored = localStorage.getItem(LANG_STORAGE_KEY);
    if (mirrored) return mirrored;
  }
  return parseCookieTarget();
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `pnpm --filter @handshake-agent/web test lib/i18n/translate-cookie.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/i18n/translate-cookie.ts web/lib/i18n/translate-cookie.test.ts
git commit -m "feat(web): persist active language via googtrans cookie + localStorage mirror"
```

---

### Task 4: Google engine controls (`lib/i18n/google-translate.ts`)

**Files:**

- Create: `web/lib/i18n/google-translate.ts`
- Test: `web/lib/i18n/google-translate.test.ts`

**Interfaces:**

- Consumes: `setActiveLanguageCode`, `clearActiveLanguage` from `./translate-cookie`; `DEFAULT_LANGUAGE_CODE` from `./languages`.
- Produces:
  - `installReactSafetyPatch(): void` — idempotent `Node.prototype.removeChild`/`insertBefore` guard.
  - `findTranslateCombo(): HTMLSelectElement | null` — returns the `.goog-te-combo` if present.
  - `applyLanguageToLivePage(code: string, opts?: { reload?: () => void }): void` — writes the cookie, then drives the combo if present (no reload) else calls `opts.reload` (default `location.reload`).
  - `resetToOriginal(opts?: { reload?: () => void }): void` — clears the cookie + reloads (reliable Google reset).

- [ ] **Step 1: Write the failing test**

```typescript
// web/lib/i18n/google-translate.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  installReactSafetyPatch,
  findTranslateCombo,
  applyLanguageToLivePage,
  resetToOriginal,
} from "./google-translate";
import { GOOGTRANS_COOKIE } from "./translate-cookie";

function clearCookies() {
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=;max-age=0;path=/`;
  }
}

describe("google-translate controls", () => {
  beforeEach(() => {
    clearCookies();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("installReactSafetyPatch makes removeChild a no-op for foreign nodes", () => {
    installReactSafetyPatch();
    const a = document.createElement("div");
    const b = document.createElement("div");
    const orphan = document.createElement("span");
    a.appendChild(orphan);
    // Removing `orphan` from `b` (not its parent) would normally throw.
    expect(() => b.removeChild(orphan)).not.toThrow();
    // Legitimate removal still works.
    expect(() => a.removeChild(orphan)).not.toThrow();
    expect(a.contains(orphan)).toBe(false);
  });

  it("applyLanguageToLivePage drives the combo when present (no reload)", () => {
    const combo = document.createElement("select");
    combo.className = "goog-te-combo";
    const opt = document.createElement("option");
    opt.value = "fr";
    combo.appendChild(opt);
    document.body.appendChild(combo);
    const changed = vi.fn();
    combo.addEventListener("change", changed);
    const reload = vi.fn();

    applyLanguageToLivePage("fr", { reload });

    expect(document.cookie).toContain(`${GOOGTRANS_COOKIE}=/en/fr`);
    expect(combo.value).toBe("fr");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("applyLanguageToLivePage reloads when no combo exists", () => {
    const reload = vi.fn();
    applyLanguageToLivePage("de", { reload });
    expect(document.cookie).toContain(`${GOOGTRANS_COOKIE}=/en/de`);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("resetToOriginal clears the cookie and reloads", () => {
    document.cookie = `${GOOGTRANS_COOKIE}=/en/fr;path=/`;
    const reload = vi.fn();
    resetToOriginal({ reload });
    expect(document.cookie).not.toContain(`${GOOGTRANS_COOKIE}=/en/fr`);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("findTranslateCombo returns null when absent", () => {
    expect(findTranslateCombo()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm --filter @handshake-agent/web test lib/i18n/google-translate.test.ts`
Expected: FAIL — import cannot resolve.

- [ ] **Step 3: Implement**

```typescript
// web/lib/i18n/google-translate.ts
import { setActiveLanguageCode, clearActiveLanguage } from "./translate-cookie";

type ReloadOpts = { reload?: () => void };

function doReload(opts?: ReloadOpts): void {
  if (opts?.reload) return opts.reload();
  if (typeof window !== "undefined") window.location.reload();
}

let patched = false;

/**
 * Google Translate wraps text nodes in <font> tags, desyncing React's virtual
 * DOM and causing `removeChild`/`insertBefore` NotFoundError crashes. Guarding
 * these two methods to no-op on foreign nodes keeps the app alive. Idempotent.
 * See facebook/react#11538.
 */
export function installReactSafetyPatch(): void {
  if (patched || typeof Node === "undefined") return;
  patched = true;

  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(
    newNode: T,
    referenceNode: Node | null,
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      return newNode;
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T;
  };
}

export function findTranslateCombo(): HTMLSelectElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLSelectElement>(".goog-te-combo");
}

/**
 * Switch the live page to `code`. Persists the choice (cookie + mirror) then
 * either drives Google's hidden combo (instant, no reload) or, if the engine
 * has not rendered a combo, reloads so Google applies the cookie on load.
 */
export function applyLanguageToLivePage(code: string, opts?: ReloadOpts): void {
  setActiveLanguageCode(code);
  const combo = findTranslateCombo();
  if (combo) {
    combo.value = code;
    combo.dispatchEvent(new Event("change"));
    return;
  }
  doReload(opts);
}

/** Reset to the untranslated source. Clearing the cookie + reload is the only
 * reliable way to fully undo Google Translate. */
export function resetToOriginal(opts?: ReloadOpts): void {
  clearActiveLanguage();
  doReload(opts);
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `pnpm --filter @handshake-agent/web test lib/i18n/google-translate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/i18n/google-translate.ts web/lib/i18n/google-translate.test.ts
git commit -m "feat(web): Google Translate engine controls + React DOM-safety patch"
```

---

### Task 5: TranslationProvider + `useTranslation` + hide-banner CSS

**Files:**

- Create: `web/components/shared/translation-provider.tsx`
- Test: `web/components/shared/translation-provider.test.tsx`
- Modify: `web/app/globals.css` (append hide-Google rules)
- Modify: `web/types/components.ts` (add `TranslationContextValue`)

**Interfaces:**

- Consumes: `SUPPORTED_LANGUAGES`, `DEFAULT_LANGUAGE_CODE`, `findLanguage`, `type Language` from `@/lib/i18n/languages`; `detectBrowserLanguage` from `@/lib/i18n/browser-language`; `getActiveLanguageCode`, `setActiveLanguageCode` from `@/lib/i18n/translate-cookie`; `installReactSafetyPatch`, `applyLanguageToLivePage`, `resetToOriginal` from `@/lib/i18n/google-translate`; default export `GoogleTranslate` from `next-google-translate-widget`.
- Produces: `TranslationProvider` (component); `useTranslation(): { language: Language; languages: readonly Language[]; setLanguage(code: string): void; resetLanguage(): void }`.

- [ ] **Step 1: Add the context type to `types/components.ts`**

Append:

```typescript
// web/types/components.ts (append near the other context/provider types)
import type { Language } from "@/lib/i18n/languages";

export interface TranslationContextValue {
  language: Language;
  languages: readonly Language[];
  setLanguage: (code: string) => void;
  resetLanguage: () => void;
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// web/components/shared/translation-provider.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// The npm widget injects Google's network script — stub it to a hidden marker.
vi.mock("next-google-translate-widget", () => ({
  default: () => <div data-testid="gt-engine" />,
}))

const applyLanguageToLivePage = vi.fn()
const resetToOriginal = vi.fn()
const installReactSafetyPatch = vi.fn()
vi.mock("@/lib/i18n/google-translate", () => ({
  applyLanguageToLivePage: (...a: unknown[]) => applyLanguageToLivePage(...a),
  resetToOriginal: (...a: unknown[]) => resetToOriginal(...a),
  installReactSafetyPatch: () => installReactSafetyPatch(),
}))

let stored: string | null = null
const setActiveLanguageCode = vi.fn()
vi.mock("@/lib/i18n/translate-cookie", () => ({
  getActiveLanguageCode: () => stored,
  setActiveLanguageCode: (...a: unknown[]) => setActiveLanguageCode(...a),
}))

vi.mock("@/lib/i18n/browser-language", () => ({
  detectBrowserLanguage: () => "de",
}))

import {
  TranslationProvider,
  useTranslation,
} from "./translation-provider"

function Probe() {
  const { language, setLanguage, resetLanguage } = useTranslation()
  return (
    <div>
      <span data-testid="current">{language.code}</span>
      <button onClick={() => setLanguage("fr")}>set-fr</button>
      <button onClick={resetLanguage}>reset</button>
    </div>
  )
}

describe("TranslationProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stored = null
  })

  it("mounts the engine and installs the safety patch once", () => {
    render(
      <TranslationProvider>
        <Probe />
      </TranslationProvider>
    )
    expect(screen.getByTestId("gt-engine")).toBeInTheDocument()
    expect(installReactSafetyPatch).toHaveBeenCalledTimes(1)
  })

  it("applies the detected language on first visit when nothing is stored", () => {
    render(
      <TranslationProvider>
        <Probe />
      </TranslationProvider>
    )
    // detected "de" persisted (so Google reads it on engine init).
    expect(setActiveLanguageCode).toHaveBeenCalledWith("de")
    expect(screen.getByTestId("current")).toHaveTextContent("de")
  })

  it("prefers the stored language over detection", () => {
    stored = "es"
    render(
      <TranslationProvider>
        <Probe />
      </TranslationProvider>
    )
    expect(screen.getByTestId("current")).toHaveTextContent("es")
  })

  it("setLanguage drives the live page and updates context", async () => {
    const user = userEvent.setup()
    render(
      <TranslationProvider>
        <Probe />
      </TranslationProvider>
    )
    await user.click(screen.getByText("set-fr"))
    expect(applyLanguageToLivePage).toHaveBeenCalledWith("fr")
    expect(screen.getByTestId("current")).toHaveTextContent("fr")
  })

  it("resetLanguage resets to English", async () => {
    stored = "es"
    const user = userEvent.setup()
    render(
      <TranslationProvider>
        <Probe />
      </TranslationProvider>
    )
    await user.click(screen.getByText("reset"))
    expect(resetToOriginal).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("current")).toHaveTextContent("en")
  })
})
```

- [ ] **Step 3: Run it and verify it fails**

Run: `pnpm --filter @handshake-agent/web test components/shared/translation-provider.test.tsx`
Expected: FAIL — import cannot resolve.

- [ ] **Step 4: Implement the provider**

```tsx
// web/components/shared/translation-provider.tsx
"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import GoogleTranslate from "next-google-translate-widget";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE_CODE,
  findLanguage,
  type Language,
} from "@/lib/i18n/languages";
import { detectBrowserLanguage } from "@/lib/i18n/browser-language";
import {
  getActiveLanguageCode,
  setActiveLanguageCode,
} from "@/lib/i18n/translate-cookie";
import {
  installReactSafetyPatch,
  applyLanguageToLivePage,
  resetToOriginal,
} from "@/lib/i18n/google-translate";
import type { TranslationContextValue } from "@/types/components";

const DEFAULT_LANGUAGE =
  findLanguage(DEFAULT_LANGUAGE_CODE) ?? SUPPORTED_LANGUAGES[0];

const TranslationContext = createContext<TranslationContextValue | null>(null);

export function TranslationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const initialised = useRef(false);

  // One-time: install the DOM-safety patch and resolve the initial language
  // (stored choice wins; else browser detection). Persist it synchronously so
  // Google's engine reads the cookie when its async script initialises — no
  // reload needed on first paint.
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    installReactSafetyPatch();

    const stored = getActiveLanguageCode();
    const detected = detectBrowserLanguage(
      typeof navigator !== "undefined" ? (navigator.languages ?? []) : [],
    );
    const code = stored ?? detected;
    const resolved = findLanguage(code) ?? DEFAULT_LANGUAGE;

    if (resolved.code !== DEFAULT_LANGUAGE_CODE) {
      // Persist so the engine auto-applies on init; no live reload on mount.
      if (!stored) setActiveLanguageCode(resolved.code);
      setLanguageState(resolved);
    }
  }, []);

  function setLanguage(code: string): void {
    const next = findLanguage(code) ?? DEFAULT_LANGUAGE;
    setLanguageState(next);
    if (next.code === DEFAULT_LANGUAGE_CODE) {
      resetToOriginal();
      return;
    }
    applyLanguageToLivePage(next.code);
  }

  function resetLanguage(): void {
    setLanguageState(DEFAULT_LANGUAGE);
    resetToOriginal();
  }

  return (
    <TranslationContext.Provider
      value={{
        language,
        languages: SUPPORTED_LANGUAGES,
        setLanguage,
        resetLanguage,
      }}
    >
      {/* Hidden engine: injects Google's script + combo. Kept out of the
          a11y tree and visually gone; our LanguageSelector is the control. */}
      <div aria-hidden className="sr-only" translate="no">
        <GoogleTranslate pageLanguage="en" />
      </div>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation(): TranslationContextValue {
  const ctx = useContext(TranslationContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within a TranslationProvider");
  }
  return ctx;
}
```

- [ ] **Step 5: Append the hide-banner CSS to `globals.css`**

Append to the END of `web/app/globals.css`:

```css
/* ── Google Translate widget: hide all Google chrome ──────────────────────
   Our own LanguageSelector is the control; the embedded engine must be
   invisible and must not shift the layout (Google injects `body { top }`). */
.goog-te-banner-frame,
.skiptranslate iframe,
#goog-gt-tt,
.goog-te-balloon-frame,
.goog-tooltip,
.goog-te-gadget-icon {
  display: none !important;
}

body {
  top: 0 !important;
  position: static !important;
}

/* Google adds `.translated-ltr`/`.translated-rtl` to <body>; keep offsets flat. */
body.translated-ltr,
body.translated-rtl {
  top: 0 !important;
}
```

- [ ] **Step 6: Run the test and verify it passes**

Run: `pnpm --filter @handshake-agent/web test components/shared/translation-provider.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add web/components/shared/translation-provider.tsx web/components/shared/translation-provider.test.tsx web/app/globals.css web/types/components.ts
git commit -m "feat(web): TranslationProvider (auto-detect + engine mount) and hide Google chrome"
```

---

### Task 6: `LanguageSelector` searchable combobox

**Files:**

- Create: `web/components/shared/language-selector.tsx`
- Test: `web/components/shared/language-selector.test.tsx`
- Modify: `web/types/components.ts` (add `LanguageSelectorProps`)
- Modify: `web/components/shared/index.ts` (export the selector)

**Interfaces:**

- Consumes: `useTranslation` from `@/components/shared/translation-provider`; `type Language` from `@/lib/i18n/languages`; `cn` from `@/lib/utils`.
- Produces: `LanguageSelector` component. Follows the codebase combobox pattern (`<input role="combobox">` + `<ul role="listbox">` with `role="option"` items), like `dashboard-topbar.tsx`.

- [ ] **Step 1: Add the props type to `types/components.ts`**

Append:

```typescript
// web/types/components.ts (append)
export interface LanguageSelectorProps {
  className?: string;
}
```

- [ ] **Step 2: Write the failing test**

```tsx
// web/components/shared/language-selector.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const setLanguage = vi.fn();
const resetLanguage = vi.fn();
vi.mock("./translation-provider", () => ({
  useTranslation: () => ({
    language: { code: "en", englishName: "English", nativeName: "English" },
    languages: [
      { code: "en", englishName: "English", nativeName: "English" },
      { code: "fr", englishName: "French", nativeName: "Français" },
      { code: "yo", englishName: "Yoruba", nativeName: "Yorùbá" },
    ],
    setLanguage,
    resetLanguage,
  }),
}));

import { LanguageSelector } from "./language-selector";

describe("LanguageSelector", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a combobox showing the current language", () => {
    render(<LanguageSelector />);
    const input = screen.getByRole("combobox", { name: /language/i });
    expect(input).toBeInTheDocument();
  });

  it("filters options by English or native name", async () => {
    const user = userEvent.setup();
    render(<LanguageSelector />);
    await user.click(screen.getByRole("combobox", { name: /language/i }));
    await user.type(screen.getByRole("combobox", { name: /language/i }), "yor");
    expect(screen.getByRole("option", { name: /Yoruba/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /French/i })).toBeNull();
  });

  it("selecting a language calls setLanguage with its code", async () => {
    const user = userEvent.setup();
    render(<LanguageSelector />);
    await user.click(screen.getByRole("combobox", { name: /language/i }));
    await user.click(screen.getByRole("option", { name: /French/i }));
    expect(setLanguage).toHaveBeenCalledWith("fr");
  });

  it("selecting English (the default) calls setLanguage('en')", async () => {
    const user = userEvent.setup();
    render(<LanguageSelector />);
    await user.click(screen.getByRole("combobox", { name: /language/i }));
    await user.click(screen.getByRole("option", { name: /^English/i }));
    expect(setLanguage).toHaveBeenCalledWith("en");
  });

  it("is excluded from translation (translate=no)", () => {
    const { container } = render(<LanguageSelector />);
    expect(container.firstChild).toHaveAttribute("translate", "no");
  });
});
```

- [ ] **Step 3: Run it and verify it fails**

Run: `pnpm --filter @handshake-agent/web test components/shared/language-selector.test.tsx`
Expected: FAIL — import cannot resolve.

- [ ] **Step 4: Implement**

```tsx
// web/components/shared/language-selector.tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslation } from "./translation-provider";
import { cn } from "@/lib/utils";
import type { LanguageSelectorProps } from "@/types/components";

const LISTBOX_ID = "language-selector-listbox";

export function LanguageSelector({ className }: LanguageSelectorProps) {
  const { language, languages, setLanguage } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return languages;
    return languages.filter(
      (l) =>
        l.englishName.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        l.code.toLowerCase() === q,
    );
  }, [query, languages]);

  function choose(code: string) {
    setLanguage(code);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    // translate="no" so Google never rewrites language names / this control.
    <div className={cn("relative", className)} translate="no">
      <input
        ref={inputRef}
        role="combobox"
        aria-label="Language"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={LISTBOX_ID}
        value={open ? query : language.nativeName}
        placeholder="Search languages…"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={cn(
          "w-full rounded-[12px] border border-border bg-card px-4 py-2.5",
          "text-[14px] font-semibold text-foreground outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
        )}
      />
      {open && (
        <ul
          id={LISTBOX_ID}
          role="listbox"
          className={cn(
            "absolute z-40 mt-1 max-h-64 w-full overflow-y-auto",
            "rounded-[14px] border border-border bg-card p-1.5 shadow-dropdown",
          )}
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No languages found
            </li>
          ) : (
            filtered.map((l) => (
              <li
                key={l.code}
                role="option"
                aria-selected={l.code === language.code}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(l.code);
                }}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3",
                  "rounded-[10px] px-3 py-2 text-sm hover:bg-muted",
                  l.code === language.code &&
                    "bg-foreground text-background hover:bg-foreground",
                )}
              >
                <span className="font-semibold">{l.nativeName}</span>
                <span className="text-xs text-muted-foreground">
                  {l.englishName}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Export from the shared barrel**

Add to `web/components/shared/index.ts`:

```typescript
export * from "./language-selector";
```

- [ ] **Step 6: Run the test and verify it passes**

Run: `pnpm --filter @handshake-agent/web test components/shared/language-selector.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add web/components/shared/language-selector.tsx web/components/shared/language-selector.test.tsx web/components/shared/index.ts web/types/components.ts
git commit -m "feat(web): searchable LanguageSelector combobox"
```

---

### Task 7: Shared `SettingsPanel` (extract desktop settings body)

**Files:**

- Create: `web/components/settings/settings-panel.tsx`
- Test: `web/components/settings/settings-panel.test.tsx`
- Modify: `web/types/components.ts` (add `SettingsPanelProps`)

**Interfaces:**

- Consumes: `useProfile`, `useLogout` from `@/lib/query/auth`; `useConfig` from `@/lib/query/hooks`; `LanguageSelector` from `@/components/shared`; `Switch`, `Button`, `Skeleton` from `@/components/ui/*`; `AvatarPlaceholder` from `@/components/shared`; `formatFiatAmount` from `@/lib/format/money`; `cn` from `@/lib/utils`.
- Produces: `SettingsPanel` component with `density?: "desktop" | "mobile"`.

This moves the body of `components/desktop/settings-page.tsx` into a shared, density-aware component and swaps the dead language pills for `<LanguageSelector />`. Read the current `settings-page.tsx` first and preserve its markup (profile / security / daily-limit / logout); only the Language section changes.

- [ ] **Step 1: Add the props type to `types/components.ts`**

Append:

```typescript
// web/types/components.ts (append)
export interface SettingsPanelProps {
  density?: "desktop" | "mobile";
  className?: string;
}
```

- [ ] **Step 2: Write the failing test**

```tsx
// web/components/settings/settings-panel.test.tsx
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/query/auth", () => ({
  useProfile: () => ({
    isLoading: false,
    isError: false,
    data: {
      email: "user@example.com",
      fullName: "Ada Tester",
      phone: null,
      kycStatus: "verified",
      kycTier: "tier_1",
      fiatCurrency: "NGN",
      limits: null,
    },
  }),
  useLogout: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/query/hooks", () => ({
  useConfig: () => ({ data: { fiats: [{ code: "NGN", symbol: "₦" }] } }),
}));

// LanguageSelector needs the translation context; stub it here.
vi.mock("@/components/shared/language-selector", () => ({
  LanguageSelector: () => <div data-testid="language-selector" />,
}));

import { SettingsPanel } from "./settings-panel";

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe("SettingsPanel", () => {
  it("renders the profile name and the language selector", () => {
    render(<SettingsPanel />, { wrapper });
    expect(screen.getByText("Ada Tester")).toBeInTheDocument();
    expect(screen.getByTestId("language-selector")).toBeInTheDocument();
  });

  it("renders a logout control", () => {
    render(<SettingsPanel />, { wrapper });
    expect(
      screen.getByRole("button", { name: /log out/i }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it and verify it fails**

Run: `pnpm --filter @handshake-agent/web test components/settings/settings-panel.test.tsx`
Expected: FAIL — import cannot resolve.

- [ ] **Step 4: Implement**

Read `web/components/desktop/settings-page.tsx` and move its body here, wrapping the outer padding based on `density`. Replace the Language pill block (its old lines 147–173) with `<LanguageSelector />`. The result:

```tsx
// web/components/settings/settings-panel.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AvatarPlaceholder, LanguageSelector } from "@/components/shared";
import { useProfile, useLogout } from "@/lib/query/auth";
import { useConfig } from "@/lib/query/hooks";
import { formatFiatAmount } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import type { SettingsPanelProps } from "@/types/components";

function tierLabel(tier: string): string {
  if (tier === "unverified") return "Unverified";
  return tier.replace(/^tier_/, "Tier ");
}

/**
 * Shared settings body — used by the desktop settings page and the mobile
 * Settings tab. Profile card + daily limit come from GET /profile (four async
 * branches); Security (PIN/Face-ID) is UI-only; Language drives Google Translate
 * via the shared LanguageSelector.
 */
export function SettingsPanel({
  density = "desktop",
  className,
}: SettingsPanelProps) {
  const [faceIdOn, setFaceIdOn] = useState(true);
  const profile = useProfile();
  const config = useConfig();
  const logout = useLogout();
  const router = useRouter();
  const fiatSymbol =
    config.data?.fiats.find((f) => f.code === profile.data?.fiatCurrency)
      ?.symbol ?? "";

  function handleLogout() {
    logout.mutate(undefined, { onSettled: () => router.push("/login") });
  }

  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-4 overflow-y-auto",
        density === "mobile" ? "p-4" : "p-6",
        className,
      )}
    >
      <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
        Settings
      </h1>

      {/* Profile card (loading / error / data) */}
      {profile.isLoading ? (
        <div className="flex items-center gap-[14px] rounded-[16px] border border-border bg-card px-5 py-[18px]">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-1.5 h-3 w-40" />
          </div>
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
      ) : profile.isError || !profile.data ? (
        <div className="border-danger/20 bg-danger/5 rounded-[16px] border px-5 py-[18px]">
          <p className="text-danger text-sm font-semibold">
            Could not load your profile.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-[14px] rounded-[16px] border border-border bg-card px-5 py-[18px]">
          <AvatarPlaceholder size={48} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-foreground">
              {profile.data.fullName ?? profile.data.email}
            </p>
            {profile.data.phone ? (
              <p className="text-[13px] text-muted-foreground tabular-nums">
                {profile.data.phone}
              </p>
            ) : profile.data.fullName ? (
              <p className="truncate text-[13px] text-muted-foreground">
                {profile.data.email}
              </p>
            ) : null}
          </div>
          <span className="rounded-full bg-success-muted px-3 py-1.5 text-xs font-bold text-success">
            {profile.data.kycStatus === "verified"
              ? "Verified"
              : profile.data.kycStatus}{" "}
            · {tierLabel(profile.data.kycTier)}
          </span>
        </div>
      )}

      {/* Security (UI-only) */}
      <div className="overflow-hidden rounded-[16px] border border-border bg-card">
        <p className="border-b border-border px-5 py-[13px] text-xs font-bold tracking-widest text-muted-foreground uppercase">
          Security
        </p>
        <div className="flex items-center border-b border-border px-5 py-[15px]">
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              Transaction PIN
            </p>
            <p className="text-[12.5px] text-muted-foreground">
              Required for every money movement
            </p>
          </div>
          <button
            type="button"
            className="cursor-pointer text-[13px] font-bold text-primary"
          >
            Change
          </button>
        </div>
        <div className="flex items-center px-5 py-[15px]">
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              Face ID / biometric
            </p>
            <p className="text-[12.5px] text-muted-foreground">
              Use biometrics to approve payments
            </p>
          </div>
          <Switch
            checked={faceIdOn}
            onCheckedChange={setFaceIdOn}
            aria-label="Face ID / biometric toggle"
          />
        </div>
      </div>

      {/* Language — drives Google Translate */}
      <div className="rounded-[16px] border border-border bg-card px-5 py-4">
        <p className="mb-3 text-xs font-bold tracking-widest text-muted-foreground uppercase">
          Language
        </p>
        <LanguageSelector />
        <p className="mt-2 text-[12px] text-muted-foreground">
          Translated automatically. Amounts and addresses are never translated.
        </p>
      </div>

      {/* Daily limit — real tier limits from /profile */}
      {profile.data?.limits && (
        <div className="flex items-center rounded-[16px] border border-border bg-card px-5 py-4">
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              Daily transfer limit
            </p>
            <p className="text-[12.5px] text-muted-foreground">
              {tierLabel(profile.data.kycTier)} verified
            </p>
          </div>
          <span className="text-[15px] font-extrabold text-foreground tabular-nums">
            {formatFiatAmount(
              String(profile.data.limits.dailyFiatMax),
              fiatSymbol,
            )}
          </span>
        </div>
      )}

      <Button
        variant="outline"
        className="border-danger/30 text-danger hover:bg-danger/5 hover:text-danger w-full rounded-[14px] font-semibold"
        onClick={handleLogout}
        disabled={logout.isPending}
        aria-label="Log out"
      >
        {logout.isPending ? "Logging out…" : "Log out"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `pnpm --filter @handshake-agent/web test components/settings/settings-panel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add web/components/settings/settings-panel.tsx web/components/settings/settings-panel.test.tsx web/types/components.ts
git commit -m "feat(web): shared SettingsPanel with language selector"
```

---

### Task 8: Rewire the desktop settings page + drop dead `LANGUAGES`

**Files:**

- Modify: `web/components/desktop/settings-page.tsx` (becomes a thin wrapper)
- Modify: `web/lib/constants.ts` (remove the dead `LANGUAGES` const)
- Test: `web/components/desktop/settings-page.test.tsx` (create if absent; else update)

**Interfaces:**

- Consumes: `SettingsPanel` from `@/components/settings/settings-panel`.
- Produces: `SettingsPage` (unchanged export name, still rendered by `dashboard-experience.tsx`).

- [ ] **Step 1: Write/adjust the test**

```tsx
// web/components/desktop/settings-page.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/settings/settings-panel", () => ({
  SettingsPanel: (props: { density?: string }) => (
    <div
      data-testid="settings-panel"
      data-density={props.density ?? "desktop"}
    />
  ),
}));

import { SettingsPage } from "./settings-page";

describe("SettingsPage (desktop)", () => {
  it("renders the shared SettingsPanel at desktop density", () => {
    render(<SettingsPage />);
    const panel = screen.getByTestId("settings-panel");
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute("data-density", "desktop");
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm --filter @handshake-agent/web test components/desktop/settings-page.test.tsx`
Expected: FAIL — `SettingsPage` still renders the old body (no `settings-panel` testid).

- [ ] **Step 3: Replace the desktop page body**

```tsx
// web/components/desktop/settings-page.tsx
"use client";

import { SettingsPanel } from "@/components/settings/settings-panel";

/** Desktop settings route body — delegates to the shared panel. */
export function SettingsPage({ className }: { className?: string }) {
  return <SettingsPanel density="desktop" className={className} />;
}
```

- [ ] **Step 4: Remove the dead `LANGUAGES` const**

In `web/lib/constants.ts`, delete the block:

```typescript
/** Supported UI languages (in display order) */
export const LANGUAGES = [
  "English",
  "Pidgin",
  "Hausa",
  "Yoruba",
  "Igbo",
] as const;
```

(Leave `GREETING_M` / `greetingDesktop` untouched — those describe which languages you can _type to the agent_, not UI translation.)

- [ ] **Step 5: Run tests + typecheck (catches any other `LANGUAGES` importers)**

Run:

```bash
pnpm --filter @handshake-agent/web test components/desktop/settings-page.test.tsx
pnpm --filter @handshake-agent/web typecheck
```

Expected: test PASS; typecheck PASS (the only `LANGUAGES` importer was the old settings page, now removed).

- [ ] **Step 6: Commit**

```bash
git add web/components/desktop/settings-page.tsx web/components/desktop/settings-page.test.tsx web/lib/constants.ts
git commit -m "refactor(web): desktop settings page delegates to shared panel; drop dead LANGUAGES"
```

---

### Task 9: Mobile Settings tab

**Files:**

- Modify: `web/types/components.ts` (`MobileTabId += "settings"`)
- Modify: `web/components/mobile/mobile-tabbar.tsx` (gear icon + tab)
- Modify: `web/components/mobile/mobile-shell.tsx` (render the panel)
- Test: `web/components/mobile/mobile-tabbar.test.tsx` (create if absent)

**Interfaces:**

- Consumes: `SettingsPanel` from `@/components/settings/settings-panel`.
- Produces: a 4th bottom-bar tab `"settings"`; `MobileShell` renders `<SettingsPanel density="mobile" />` when the settings tab is active.

- [ ] **Step 1: Extend `MobileTabId`**

In `web/types/components.ts`, change:

```typescript
export type MobileTabId = "chat" | "wallet" | "activity";
```

to:

```typescript
export type MobileTabId = "chat" | "wallet" | "activity" | "settings";
```

- [ ] **Step 2: Write the failing tabbar test**

```tsx
// web/components/mobile/mobile-tabbar.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileTabbar } from "./mobile-tabbar";

describe("MobileTabbar", () => {
  it("renders a Settings tab", () => {
    render(<MobileTabbar active="chat" onSelect={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Settings" }),
    ).toBeInTheDocument();
  });

  it("calls onSelect('settings') when the Settings tab is tapped", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MobileTabbar active="chat" onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(onSelect).toHaveBeenCalledWith("settings");
  });
});
```

- [ ] **Step 3: Run it and verify it fails**

Run: `pnpm --filter @handshake-agent/web test components/mobile/mobile-tabbar.test.tsx`
Expected: FAIL — no "Settings" button.

- [ ] **Step 4: Add the gear icon + tab entry to `mobile-tabbar.tsx`**

Add this icon next to the other icon components (after `ActivityIcon`):

```tsx
function SettingsIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M11 2.5v2M11 17.5v2M2.5 11h2M17.5 11h2M5 5l1.4 1.4M15.6 15.6L17 17M17 5l-1.4 1.4M6.4 15.6L5 17"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
```

Then append the tab entry to the `TABS` array:

```tsx
const TABS: {
  id: MobileTabId;
  label: string;
  Icon: () => React.JSX.Element;
}[] = [
  { id: "chat", label: "Chat", Icon: ChatIcon },
  { id: "wallet", label: "Wallet", Icon: WalletIcon },
  { id: "activity", label: "Activity", Icon: ActivityIcon },
  { id: "settings", label: "Settings", Icon: SettingsIcon },
] as const;
```

- [ ] **Step 5: Run the tabbar test and verify it passes**

Run: `pnpm --filter @handshake-agent/web test components/mobile/mobile-tabbar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Render the panel in `mobile-shell.tsx`**

Add the import near the other tab imports:

```tsx
import { SettingsPanel } from "@/components/settings/settings-panel";
```

Then, after the existing `{tab === "activity" && <ActivityTab />}` line (inside `<main>`), add:

```tsx
{
  tab === "settings" && <SettingsPanel density="mobile" />;
}
```

- [ ] **Step 7: Verify the shell still builds (typecheck)**

Run: `pnpm --filter @handshake-agent/web typecheck`
Expected: PASS — the `MobileTabId` switch now covers `"settings"`.

- [ ] **Step 8: Commit**

```bash
git add web/types/components.ts web/components/mobile/mobile-tabbar.tsx web/components/mobile/mobile-tabbar.test.tsx web/components/mobile/mobile-shell.tsx
git commit -m "feat(web): add mobile Settings tab to the bottom bar"
```

---

### Task 10: Mount `TranslationProvider` app-wide

**Files:**

- Modify: `web/components/providers.tsx`
- Test: `web/components/providers.test.tsx` (update existing)

**Interfaces:**

- Consumes: `TranslationProvider` from `@/components/shared/translation-provider`.

- [ ] **Step 1: Update the providers test**

Add to `web/components/providers.test.tsx` (mock the widget so no network fires):

```tsx
vi.mock("next-google-translate-widget", () => ({
  default: () => <div data-testid="gt-engine" />,
}));
```

and a test:

```tsx
it("mounts the translation engine", () => {
  render(
    <Providers>
      <span>child</span>
    </Providers>,
  );
  expect(screen.getByTestId("gt-engine")).toBeInTheDocument();
});
```

(Keep the existing imports/mocks in that file; if `render`/`screen` aren't imported yet, add `import { render, screen } from "@testing-library/react"` and `import { vi, it, expect } from "vitest"` as needed.)

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm --filter @handshake-agent/web test components/providers.test.tsx`
Expected: FAIL — no `gt-engine` (provider not mounted yet).

- [ ] **Step 3: Wrap children with `TranslationProvider` (innermost)**

```tsx
// web/components/providers.tsx
"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { TranslationProvider } from "@/components/shared/translation-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );
  return (
    <ThemeProvider attribute="class" forcedTheme="light">
      <QueryClientProvider client={client}>
        <AuthProvider>
          <TranslationProvider>{children}</TranslationProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `pnpm --filter @handshake-agent/web test components/providers.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/providers.tsx web/components/providers.test.tsx
git commit -m "feat(web): mount TranslationProvider app-wide"
```

---

### Task 11: `translate="no"` on money-critical nodes

**Files:**

- Modify: `web/components/shared/money.tsx`
- Modify: `web/components/shared/detail-rows.tsx`
- Modify: `web/components/chat/cards/receive-card.tsx`
- Modify: `web/components/chat/cards/receipt-card.tsx`
- Modify: `web/components/shared/transaction-detail-modal.tsx`
- Test: `web/components/shared/money.test.tsx`, `web/components/shared/detail-rows.test.tsx` (create if absent)

**Interfaces:** none new — adds the `translate="no"` attribute to existing value spans.

Rationale: `Money` and `DetailRows` are the two atoms nearly all amounts and detail rows (references, addresses) flow through — marking them covers most sites in one place. The remaining raw `font-mono` address/hash/ref spans get the attribute directly.

- [ ] **Step 1: Write failing tests for the two atoms**

```tsx
// web/components/shared/money.test.tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Money } from "./money";

describe("Money", () => {
  it("marks the amount as non-translatable", () => {
    const { container } = render(<Money value="₦50,000" />);
    // The value-bearing element carries translate="no".
    expect(container.querySelector('[translate="no"]')).not.toBeNull();
  });
});
```

```tsx
// web/components/shared/detail-rows.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetailRows } from "./detail-rows";

describe("DetailRows", () => {
  it("marks row values as non-translatable", () => {
    render(<DetailRows rows={[{ label: "Reference", value: "HS-abc123" }]} />);
    expect(screen.getByText("HS-abc123")).toHaveAttribute("translate", "no");
  });
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm --filter @handshake-agent/web test components/shared/money.test.tsx components/shared/detail-rows.test.tsx`
Expected: FAIL — no `translate="no"` yet.

- [ ] **Step 3: Add the attribute in each site**

- `web/components/shared/money.tsx`: on the root value `<span>` (the one carrying `tabular-nums`), add `translate="no"`.
- `web/components/shared/detail-rows.tsx`: on the value span (`<span className="text-sm font-semibold tabular-nums">{row.value}</span>`), add `translate="no"`.
- `web/components/chat/cards/receive-card.tsx`: on the address `<span>` that renders `{address}` (the `font-mono … break-all` span), add `translate="no"`.
- `web/components/chat/cards/receipt-card.tsx`: on the `<span className="font-mono …">{txRef}</span>`, add `translate="no"`.
- `web/components/shared/transaction-detail-modal.tsx`: on both the counterparty `<span className="font-mono">{shortAddress(...)}</span>` and the tx-hash `<span className="font-mono">{shortHash(...)}</span>`, add `translate="no"`.

Example (detail-rows.tsx):

```tsx
<span className="text-sm font-semibold tabular-nums" translate="no">
  {row.value}
</span>
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm --filter @handshake-agent/web test components/shared/money.test.tsx components/shared/detail-rows.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/shared/money.tsx web/components/shared/money.test.tsx web/components/shared/detail-rows.tsx web/components/shared/detail-rows.test.tsx web/components/chat/cards/receive-card.tsx web/components/chat/cards/receipt-card.tsx web/components/shared/transaction-detail-modal.tsx
git commit -m "feat(web): exclude amounts/addresses/refs from translation (translate=no)"
```

---

### Task 12: E2E — language selection persists (Google script stubbed)

**Files:**

- Create: `web/e2e/language.spec.ts`

**Interfaces:** none — full-stack behavioural check.

Uses the existing authed-e2e stub pattern (see other specs under `web/e2e/`). Stubs the Google Translate script so CI never hits the network; asserts our seam (the `googtrans` cookie is written and the choice survives reload).

- [ ] **Step 1: Write the e2e spec**

```typescript
// web/e2e/language.spec.ts
import { test, expect } from "@playwright/test";

// Prevent the real Google script from loading in CI; our cookie seam is what
// we assert. (If your e2e suite has an auth-stub helper, reuse it to reach
// /dashboard; otherwise this navigates the public shell.)
test.beforeEach(async ({ page }) => {
  await page.route("**/translate.google.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "",
    }),
  );
});

test("selecting a language writes the googtrans cookie and persists", async ({
  page,
}) => {
  await page.goto("/dashboard");

  // Open settings (desktop sidebar) → Language selector.
  await page.getByRole("button", { name: /settings/i }).click();
  const combo = page.getByRole("combobox", { name: /language/i });
  await combo.click();
  await combo.fill("Fran");
  await page.getByRole("option", { name: /French/i }).click();

  const cookies = await page.context().cookies();
  const googtrans = cookies.find((c) => c.name === "googtrans");
  expect(googtrans?.value).toContain("/en/fr");

  // Survives reload (persistence).
  await page.reload();
  const after = (await page.context().cookies()).find(
    (c) => c.name === "googtrans",
  );
  expect(after?.value).toContain("/en/fr");
});
```

- [ ] **Step 2: Run the e2e (may require the auth-stub env used by other e2e specs)**

Run: `pnpm --filter @handshake-agent/web exec playwright test e2e/language.spec.ts`
Expected: PASS. If the run can't authenticate to reach `/dashboard`, adapt to the repo's existing e2e auth-stub helper (see sibling `web/e2e/*.spec.ts`). If the Google script/DOM proves flaky in CI, keep this spec but mark it `test.describe.configure({ mode: "serial" })` or `test.skip` in CI — the unit tests already cover the cookie/combo/detection seams.

- [ ] **Step 3: Commit**

```bash
git add web/e2e/language.spec.ts
git commit -m "test(web): e2e language selection persists via googtrans cookie"
```

---

### Task 13: Full gate sweep

- [ ] **Step 1: Run the whole web test suite**

Run: `pnpm --filter @handshake-agent/web test`
Expected: all green, including the pre-existing suite.

- [ ] **Step 2: Typecheck + lint (bare eslint, not the --fix script per repo note)**

Run:

```bash
pnpm --filter @handshake-agent/web typecheck
pnpm --filter @handshake-agent/web exec eslint components/shared/translation-provider.tsx components/shared/language-selector.tsx components/settings/settings-panel.tsx lib/i18n
```

Expected: no type errors; no lint errors.

- [ ] **Step 3: Dependency-cruiser boundary check (from root)**

Run: `pnpm depcruise`
Expected: clean — `lib/i18n` owns cookie/localStorage/navigator; components only consume it.

- [ ] **Step 4: Build**

Run: `pnpm --filter @handshake-agent/web build`
Expected: succeeds.

- [ ] **Step 5: Final commit if any fixups were needed**

```bash
git add -A
git commit -m "chore(web): multi-language gate fixups"
```

---

## Self-review

**Spec coverage:**

- Auto-detect browser language → Task 2 (`detectBrowserLanguage`) + Task 5 (applied on mount). ✅
- Choose any language in Settings → Task 6 (`LanguageSelector`) + Task 7 (in `SettingsPanel`). ✅
- Full Google list (100+) → Task 1 (`SUPPORTED_LANGUAGES`, ≥100). ✅
- Whole-app scope → Task 10 (provider in root `providers.tsx`). ✅
- Persistence + precedence (stored > detected; English resets) → Tasks 3, 5. ✅
- Mobile Settings tab → Task 9. ✅
- Shared settings panel (de-fork) → Tasks 7, 8, 9. ✅
- Money-node safety (`translate="no"`) → Task 11. ✅
- Hide Google chrome → Task 5 (globals.css). ✅
- React-crash patch → Task 4 (`installReactSafetyPatch`), installed in Task 5. ✅
- Uses `next-google-translate-widget` → Task 1 (install) + Task 5 (hidden mount). ✅
- Testing seams (Vitest + Playwright) → every task + Task 12/13. ✅

**Deviations from spec (intentional, better-informed):**

- Spec §10 proposed shadcn `command`/`popover`; the codebase has no `cmdk`/popover and DOES have an established hand-rolled combobox pattern (`dashboard-topbar.tsx`). Task 6 follows that pattern instead — fewer deps, one canonical combobox.
- `useTranslation` lives in `translation-provider.tsx` (co-located with the context) rather than a separate `hooks/use-translation.ts`, avoiding a components→hooks→components import cycle.

**Placeholder scan:** none — every code step has complete code; the only "read the current file" instruction (Task 7/11) is paired with the exact resulting code or the exact attribute to add.

**Type consistency:** `Language`, `SUPPORTED_LANGUAGES`, `DEFAULT_LANGUAGE_CODE`, `findLanguage` (Task 1) are consumed unchanged in Tasks 2/5/6; `getActiveLanguageCode`/`setActiveLanguageCode`/`clearActiveLanguage` (Task 3) consumed in Tasks 4/5; `applyLanguageToLivePage`/`resetToOriginal`/`installReactSafetyPatch` (Task 4) consumed in Task 5; `TranslationContextValue`/`useTranslation` (Task 5) consumed in Task 6; `SettingsPanel` (Task 7) consumed in Tasks 8/9; `MobileTabId` (Task 9) matches the tabbar + shell. ✅
