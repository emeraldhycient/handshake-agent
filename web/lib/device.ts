/**
 * Device fingerprint helper — generates and persists a stable per-browser identifier.
 */

const DEVICE_FINGERPRINT_KEY = 'ha.deviceFingerprint'

/**
 * Returns a stable per-browser device fingerprint, persisted in localStorage.
 * SSR-safe: if running on the server, generates a fresh UUID without persisting.
 * @returns A string starting with "web-" followed by a UUID (min length 41)
 */
export function getDeviceFingerprint(): string {
  // SSR guard: if window is not available, generate and return fresh without persisting
  if (typeof window === 'undefined') {
    return `web-${crypto.randomUUID()}`
  }

  // Check if fingerprint already exists in localStorage
  const existing = localStorage.getItem(DEVICE_FINGERPRINT_KEY)
  if (existing) {
    return existing
  }

  // Generate, store, and return new fingerprint
  const fingerprint = `web-${crypto.randomUUID()}`
  localStorage.setItem(DEVICE_FINGERPRINT_KEY, fingerprint)
  return fingerprint
}
