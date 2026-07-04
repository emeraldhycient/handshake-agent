import type { MetadataRoute } from "next"
import { BRAND, SITE_DESCRIPTION, SITE_NAME, SITE_SHORT_NAME } from "@/lib/site"

/**
 * Web app manifest (served at /manifest.webmanifest). Makes the app installable
 * on mobile + desktop with no app store — Next auto-injects the `<link rel="manifest">`.
 *
 * `id` + `start_url` + `scope` pin the install identity to the root. Colours are
 * hex from lib/site BRAND (manifest cannot use the oklch tokens). We ship both
 * `any` and `maskable` icon purposes: `any` for platforms that render the icon
 * as-is, `maskable` (extra safe-zone padding) for Android adaptive icons.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE_NAME,
    short_name: SITE_SHORT_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "en",
    dir: "ltr",
    categories: ["finance", "productivity"],
    theme_color: BRAND.themeColor,
    background_color: BRAND.backgroundColor,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
