/**
 * /offline — the app-shell fallback the service worker serves when a navigation
 * fails with no network and no cached page. Static, public, no data or auth.
 */
import type { Metadata } from "next"
import Link from "next/link"
import { BrandMark } from "@/components/shared/brand-mark"
import { SITE_NAME } from "@/lib/site"

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false, follow: false },
}

export default function OfflinePage() {
  return (
    <main
      id="main-content"
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center"
    >
      <BrandMark size={56} ariaLabel={SITE_NAME} />
      <h1 className="text-xl font-bold text-foreground">
        You&rsquo;re offline
      </h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        There&rsquo;s no internet connection right now. {SITE_NAME} will pick up
        where you left off once you&rsquo;re back online.
      </p>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors outline-none hover:bg-primary/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Try again
      </Link>
    </main>
  )
}
