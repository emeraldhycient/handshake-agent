/**
 * `Date | null` → ISO-8601 string | null.
 *
 * The read-side admin services all render nullable timestamps onto the wire the
 * same way; this used to be five byte-for-byte copies of the same one-liner (§13.2
 * "three is a pattern"). Sharing one helper keeps the wire shape from drifting and
 * matches the mapper convention in `reconciliation-history.mapper.ts`. Pure and
 * side-effect-free — no PII, no clock dependency.
 */
export function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
