import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE_CODE } from "./languages"

const SUPPORTED = new Set(SUPPORTED_LANGUAGES.map((l) => l.code))

// Browser subtag / legacy alias -> Google widget code.
const ALIASES: Record<string, string> = {
  he: "iw",
  jv: "jw",
  fil: "tl",
  in: "id",
  nb: "no",
  nn: "no",
}

function resolveOne(raw: string): string | null {
  const tag = raw.trim().toLowerCase()
  if (!tag) return null

  // Chinese needs script/region inspection before generic handling.
  if (tag.startsWith("zh")) {
    if (/(tw|hk|hant|mo)/.test(tag)) return "zh-TW"
    return "zh-CN"
  }

  const base = tag.split("-")[0]
  const aliased = ALIASES[base] ?? base

  // Case-insensitive match against the supported set (which is lower-ish, but
  // codes like `zh-CN` are handled above, so remaining codes are lowercase).
  if (SUPPORTED.has(aliased)) return aliased
  return null
}

export function detectBrowserLanguage(
  navigatorLanguages: readonly string[]
): string {
  for (const raw of navigatorLanguages) {
    const match = resolveOne(raw)
    if (match) return match
  }
  return DEFAULT_LANGUAGE_CODE
}
