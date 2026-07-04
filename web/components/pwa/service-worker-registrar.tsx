"use client"

import { useEffect } from "react"
import { registerServiceWorker } from "@/lib/pwa/register-sw"

/**
 * Mounts once in the root layout to register the offline service worker after
 * hydration. Renders nothing; registration fails safe (see registerServiceWorker).
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    void registerServiceWorker()
  }, [])
  return null
}
