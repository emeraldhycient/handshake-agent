import type { MetadataRoute } from "next"
import { absoluteUrl, getSiteUrl } from "@/lib/site"

/**
 * robots.txt (served at /robots.txt). Crawlers may index the marketing/app
 * surface but not the API or token-bearing flows (KYC / email verification),
 * which carry single-use tokens and no indexable content.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/kyc", "/verify-email"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: getSiteUrl(),
  }
}
