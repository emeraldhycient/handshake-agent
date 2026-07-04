import type { Metadata, Viewport } from "next"
import {
  BRAND,
  getSiteUrl,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_SHORT_NAME,
} from "@/lib/site"

/**
 * Root metadata for the app (applied in app/layout.tsx). Kept in lib/ so it can
 * be unit-tested without importing next/font. `metadataBase` makes every
 * relative canonical/OG URL resolve absolutely; the opengraph-image /
 * twitter-image file conventions auto-attach their images to these cards.
 */
export function buildRootMetadata(): Metadata {
  return {
    metadataBase: new URL(getSiteUrl()),
    title: {
      default: SITE_NAME,
      template: `%s — ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    keywords: [
      "buy crypto",
      "sell crypto",
      "send money",
      "receive crypto",
      "USDT",
      "stablecoin wallet",
      "crypto payments",
      "chat wallet",
      "event tickets",
      "Handshake Agent",
    ],
    authors: [{ name: SITE_NAME }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    category: "finance",
    manifest: "/manifest.webmanifest",
    alternates: { canonical: "/" },
    formatDetection: { telephone: false, email: false, address: false },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: SITE_SHORT_NAME,
    },
    icons: {
      icon: [
        { url: "/icon.svg", type: "image/svg+xml" },
        { url: "/favicon.ico", sizes: "any" },
      ],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
      url: "/",
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
    },
  }
}

/**
 * Viewport config (separate export per Next 16). `themeColor` tints the mobile
 * toolbar/status bar; `viewportFit: cover` lets the app paint under the notch.
 */
export const rootViewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BRAND.themeColor },
    { media: "(prefers-color-scheme: dark)", color: BRAND.themeColorDark },
  ],
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}
