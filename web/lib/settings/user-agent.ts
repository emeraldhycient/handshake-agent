import type { ParsedUserAgent } from "@/types"

/**
 * Best-effort parse of a session's raw `userAgent` telemetry into a
 * `browser · os` label + a desktop/mobile flag for the security section.
 * No geolocation is available server-side, so this is the only device detail
 * the design's session rows can show truthfully.
 */
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  if (!ua) return { browser: "Unknown", os: "", isDesktop: true }

  const browser = detectBrowser(ua)
  const { os, isDesktop } = detectOs(ua)
  return { browser, os, isDesktop }
}

function detectBrowser(ua: string): string {
  if (/\bEdg\//.test(ua)) return "Edge"
  if (/\b(OPR|Opera)\b/.test(ua)) return "Opera"
  if (/\bFirefox\//.test(ua)) return "Firefox"
  if (/\bChrome\//.test(ua) && !/\bEdg\//.test(ua)) return "Chrome"
  if (/\bSafari\//.test(ua) && !/\bChrome\//.test(ua)) return "Safari"
  return "Browser"
}

function detectOs(ua: string): { os: string; isDesktop: boolean } {
  if (/\biPhone\b/.test(ua)) return { os: "iPhone", isDesktop: false }
  if (/\biPad\b/.test(ua)) return { os: "iPad", isDesktop: false }
  if (/\bAndroid\b/.test(ua)) return { os: "Android", isDesktop: false }
  if (/\bWindows\b/.test(ua)) return { os: "Windows", isDesktop: true }
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua))
    return { os: "macOS", isDesktop: true }
  if (/\bLinux\b/.test(ua)) return { os: "Linux", isDesktop: true }
  return { os: "Unknown", isDesktop: true }
}
