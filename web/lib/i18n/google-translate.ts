import { setActiveLanguageCode, clearActiveLanguage } from "./translate-cookie"

type ReloadOpts = { reload?: () => void }

function doReload(opts?: ReloadOpts): void {
  if (opts?.reload) return opts.reload()
  if (typeof window !== "undefined") window.location.reload()
}

let patched = false

/**
 * Google Translate wraps text nodes in <font> tags, desyncing React's virtual
 * DOM and causing `removeChild`/`insertBefore` NotFoundError crashes. Guarding
 * these two methods to no-op on foreign nodes keeps the app alive. Idempotent.
 * See facebook/react#11538.
 */
export function installReactSafetyPatch(): void {
  if (patched || typeof Node === "undefined") return
  patched = true

  const originalRemoveChild = Node.prototype.removeChild
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      return child
    }
    return originalRemoveChild.call(this, child) as T
  }

  const originalInsertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function <T extends Node>(
    newNode: T,
    referenceNode: Node | null
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      return newNode
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T
  }
}

export function findTranslateCombo(): HTMLSelectElement | null {
  if (typeof document === "undefined") return null
  return document.querySelector<HTMLSelectElement>(".goog-te-combo")
}

/**
 * Switch the live page to `code`. Persists the choice (cookie + mirror) then
 * either drives Google's hidden combo (instant, no reload) or, if the engine
 * has not rendered a combo, reloads so Google applies the cookie on load.
 */
export function applyLanguageToLivePage(code: string, opts?: ReloadOpts): void {
  setActiveLanguageCode(code)
  const combo = findTranslateCombo()
  if (combo) {
    combo.value = code
    combo.dispatchEvent(new Event("change"))
    return
  }
  doReload(opts)
}

/** Reset to the untranslated source. Clearing the cookie + reload is the only
 * reliable way to fully undo Google Translate. */
export function resetToOriginal(opts?: ReloadOpts): void {
  clearActiveLanguage()
  doReload(opts)
}
