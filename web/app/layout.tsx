import { Figtree, IBM_Plex_Mono } from "next/font/google"

import "./globals.css"
import { Providers } from "@/components/providers"
import { JsonLd } from "@/components/seo/json-ld"
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar"
import { buildRootMetadata, rootViewport } from "@/lib/seo/metadata"
import { cn } from "@/lib/utils"

const fontSans = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
})
const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
})

export const metadata = buildRootMetadata()
export const viewport = rootViewport

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(fontSans.variable, fontMono.variable)}
    >
      <body className="font-sans antialiased">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <Providers>{children}</Providers>
        <ServiceWorkerRegistrar />
        <JsonLd />
      </body>
    </html>
  )
}
