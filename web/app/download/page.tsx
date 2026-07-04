/**
 * /download — the shareable, public install page. Renders a QR that opens the
 * app's install URL on any device plus capability-aware install guidance.
 * Composition only; the interactive body is the DownloadExperience client component.
 */
import type { Metadata } from "next"
import { DownloadExperience } from "@/components/pwa/download-experience"
import { SITE_NAME } from "@/lib/site"

export const metadata: Metadata = {
  title: "Install the app",
  description: `Install ${SITE_NAME} on your phone or desktop — no app store needed. Scan the QR code or add it to your home screen.`,
  alternates: { canonical: "/download" },
  openGraph: {
    title: `Install ${SITE_NAME}`,
    description: `Get ${SITE_NAME} on your device — no app store needed.`,
    url: "/download",
  },
}

export default function DownloadPage() {
  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-background px-4 py-12"
    >
      <DownloadExperience />
    </main>
  )
}
