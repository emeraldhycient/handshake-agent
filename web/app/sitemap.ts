import type { MetadataRoute } from "next"
import { absoluteUrl } from "@/lib/site"

/** Public, indexable routes (authenticated app routes are excluded on purpose). */
const PUBLIC_ROUTES = ["/", "/download", "/login", "/signup"] as const

/**
 * sitemap.xml (served at /sitemap.xml). Lists the public routes as absolute URLs
 * so search engines discover the install page and auth entry points.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((path) => ({
    url: absoluteUrl(path),
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : 0.7,
  }))
}
