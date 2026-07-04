import {
  absoluteUrl,
  getSiteUrl,
  SITE_DESCRIPTION,
  SITE_NAME,
} from "@/lib/site"

/** A single JSON-LD node in the @graph. */
export interface StructuredDataNode {
  "@type": string
  "@id": string
  name: string
  url: string
  [key: string]: unknown
}

export interface StructuredData {
  "@context": "https://schema.org"
  "@graph": StructuredDataNode[]
}

/**
 * Site-wide JSON-LD (Organization + WebSite + WebApplication) for rich results.
 * Emitted once in the root layout. All URLs resolve against the configured origin.
 */
export function buildStructuredData(): StructuredData {
  const url = getSiteUrl()
  const orgId = `${url}/#organization`
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: SITE_NAME,
        url,
        logo: absoluteUrl("/icons/icon-512.png"),
        description: SITE_DESCRIPTION,
      },
      {
        "@type": "WebSite",
        "@id": `${url}/#website`,
        name: SITE_NAME,
        url,
        publisher: { "@id": orgId },
        inLanguage: "en",
      },
      {
        "@type": "WebApplication",
        "@id": `${url}/#webapp`,
        name: SITE_NAME,
        url,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web, Android, iOS",
        description: SITE_DESCRIPTION,
      },
    ],
  }
}
