/**
 * Syntactic UUID shape, case-insensitive and fully anchored.
 *
 * Deliberately version-agnostic: this guards a query, it is not an RFC 4122
 * validator. Postgres accepts any hex in the version nibble on a `@db.Uuid`
 * column, so narrowing to versions 1-8 here would reject rows the database
 * holds quite happily.
 *
 * Carries no `g`/`y` flag on purpose — `.test()` must stay stateless, since
 * every caller shares this one instance.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns true when `value` is a syntactically valid UUID.
 *
 * Guards any query against a `@db.Uuid` column: Postgres rejects a non-UUID
 * string with "invalid input syntax for type uuid", which surfaces as a 500
 * when e.g. a Blockradar manual-withdraw reference (not a UUID) reaches
 * `findByIdempotencyKey`. A false return means the caller must return null
 * early rather than forward the value to Prisma.
 */
export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}
