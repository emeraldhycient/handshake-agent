import { ImageResponse } from "next/og"
import { BRAND, SITE_NAME, SITE_TAGLINE } from "@/lib/site"

/**
 * Open Graph / social card (1200×630), generated at build time by next/og — no
 * external calls, CSP-safe. Renders the brand mark + wordmark on the deep-green
 * brand tile. Reused by app/twitter-image.tsx.
 */
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 40,
        backgroundColor: BRAND.greenDeep,
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 168,
          height: 168,
          borderRadius: 52,
          background: `linear-gradient(150deg, ${BRAND.accent}, ${BRAND.accentDeep})`,
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            backgroundColor: BRAND.greenDeep,
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 76,
          fontWeight: 800,
          color: "#f1f3ee",
          letterSpacing: -1,
        }}
      >
        {SITE_NAME}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 34,
          color: "#aebcb2",
        }}
      >
        {SITE_TAGLINE}
      </div>
    </div>,
    { ...size }
  )
}
