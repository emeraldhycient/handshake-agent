import { DEFAULT_LANGUAGE_CODE } from "./languages"

export const GOOGTRANS_COOKIE = "googtrans"
export const LANG_STORAGE_KEY = "ha.lang"

/** Source page language — everything translates FROM English. */
const SOURCE = DEFAULT_LANGUAGE_CODE

function writeCookie(value: string, maxAgeSeconds: number): void {
  if (typeof document === "undefined") return
  const base = `${GOOGTRANS_COOKIE}=${value};path=/;max-age=${maxAgeSeconds};samesite=lax`
  document.cookie = base
  // Google reads the cookie on the registrable domain; set a dotted-host
  // variant too when the hostname has a dot (skips `localhost`).
  const host = window.location.hostname
  if (host.includes(".")) {
    document.cookie = `${base};domain=.${host}`
  }
}

export function setActiveLanguageCode(code: string): void {
  // One year.
  writeCookie(`/${SOURCE}/${code}`, 60 * 60 * 24 * 365)
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(LANG_STORAGE_KEY, code)
  }
}

export function clearActiveLanguage(): void {
  writeCookie("", 0)
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(LANG_STORAGE_KEY)
  }
}

function parseCookieTarget(): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${GOOGTRANS_COOKIE}=`))
  if (!match) return null
  // value is `/en/<target>`
  const value = decodeURIComponent(match.slice(GOOGTRANS_COOKIE.length + 1))
  const target = value.split("/")[2]
  return target && target.length > 0 ? target : null
}

export function getActiveLanguageCode(): string | null {
  if (typeof localStorage !== "undefined") {
    const mirrored = localStorage.getItem(LANG_STORAGE_KEY)
    if (mirrored) return mirrored
  }
  return parseCookieTarget()
}
