// The /download segment overrides openGraph (custom title), so it needs its own
// image file for the branded card to attach. Reuse the root generator.
export { default, alt, size, contentType } from "../opengraph-image"
