/**
 * Register the offline service worker. Called once, client-side, after mount.
 *
 * Fails safe: unsupported browsers and registration errors resolve to `false`
 * and never throw — a broken SW must never take down the app. Returns `true`
 * only when `/sw.js` registered successfully.
 */
export async function registerServiceWorker(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return false
  }
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" })
    return true
  } catch {
    return false
  }
}
