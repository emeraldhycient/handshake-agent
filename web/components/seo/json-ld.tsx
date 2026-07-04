import { buildStructuredData } from "@/lib/seo/structured-data"

/**
 * Renders the site-wide JSON-LD structured data as a script tag. Server
 * component — the JSON is built at render time and injected as static text.
 */
export function JsonLd() {
  return (
    <script
      type="application/ld+json"
      // JSON-LD must be raw text in a script tag; the payload is our own data.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(buildStructuredData()),
      }}
    />
  )
}
