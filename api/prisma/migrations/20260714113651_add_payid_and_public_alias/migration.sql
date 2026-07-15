-- AlterTable
-- User's public handle for PayID-based sends (Spec 2). Column names follow the
-- Prisma-schema field casing (no @map on these fields, matching the existing
-- `users` table convention — e.g. `preferredFiatCurrency`, `tierChangedAt`).
ALTER TABLE "users" ADD COLUMN "payId" TEXT;
ALTER TABLE "users" ADD COLUMN "payIdChangedAt" TIMESTAMPTZ;

-- CreateIndex
-- Exact-case uniqueness (Prisma's @unique on User.payId).
CREATE UNIQUE INDEX "users_payId_key" ON "users"("payId");

-- Case-insensitive uniqueness: a plain unique index only covers exact case, and
-- Postgres NULL-distinctness already lets multiple NULLs coexist without a
-- partial predicate — but two users with payId 'Alice' and 'alice' would NOT
-- collide under users_payId_key. This partial expression index closes that gap.
CREATE UNIQUE INDEX "users_payId_lower_key" ON "users"(lower("payId")) WHERE "payId" IS NOT NULL;

-- CreateTable
CREATE TABLE "public_aliases" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "public_aliases_userId_idx" ON "public_aliases"("userId");

-- Case-insensitive uniqueness across ALL public aliases (Prisma can't express
-- `lower(alias)` in a declarative @@unique).
CREATE UNIQUE INDEX "public_aliases_alias_lower_key" ON "public_aliases"(lower("alias"));

-- AddForeignKey
ALTER TABLE "public_aliases" ADD CONSTRAINT "public_aliases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: mint a deterministic PayID for every existing user from email local-part,
-- de-duplicated with a row-number suffix so it is globally unique + non-reserved-safe.
WITH base AS (
  SELECT id,
         regexp_replace(lower(split_part(coalesce(email,'user'), '@', 1)), '[^a-z0-9_]', '', 'g') AS slug
  FROM users WHERE "payId" IS NULL
), padded AS (
  SELECT id, CASE WHEN length(slug) < 3 THEN slug || 'user' ELSE left(slug,30) END AS slug FROM base
), numbered AS (
  SELECT id, slug, row_number() OVER (PARTITION BY slug ORDER BY id) AS rn FROM padded
)
UPDATE users u SET "payId" = CASE WHEN n.rn = 1 THEN n.slug ELSE left(n.slug, 26) || n.rn::text END
FROM numbered n WHERE u.id = n.id;
