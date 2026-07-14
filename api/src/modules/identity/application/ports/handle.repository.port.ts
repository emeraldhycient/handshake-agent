/**
 * DI token for the handle repository. Infrastructure provides the concrete
 * Prisma adapter; application only knows this symbol.
 */
export const HANDLE_REPOSITORY = Symbol('HANDLE_REPOSITORY');

/**
 * A resolved handle's owner — the minimal projection HandleService needs to
 * compose a name-minimal display name (root CLAUDE.md anti-enumeration).
 * `handle` is the canonical value as stored (already lowercase — both PayId
 * and PublicAlias.alias are validated by PayIdSchema at write time).
 */
export interface HandleOwnerRecord {
  userId: string;
  handle: string;
  firstName: string | null;
  lastName: string | null;
}

/** A public nickname row as exposed to the owning user (list/create response). */
export interface PublicNicknameRecord {
  id: string;
  alias: string;
}

export interface IHandleRepository {
  /** Case-insensitive lookup of a User by payId. Null if no user claims it. */
  findUserByPayId(handleLower: string): Promise<HandleOwnerRecord | null>;

  /** Case-insensitive lookup of a PublicAlias owner. Null if no alias matches. */
  findAliasOwner(handleLower: string): Promise<HandleOwnerRecord | null>;

  /**
   * True if ANY user's payId matches (case-insensitive). Used for the
   * shared-namespace check (design §4.2: PayId + PublicAlias share one
   * namespace) before claiming a new nickname or PayID.
   */
  isPayIdTaken(handleLower: string): Promise<boolean>;

  /** True if ANY PublicAlias matches (case-insensitive). Shared-namespace check. */
  isAliasTaken(handleLower: string): Promise<boolean>;

  /** Count of public nicknames owned by the user (drives the ≤5 cap). */
  countPublicNicknames(userId: string): Promise<number>;

  /**
   * Inserts a new PublicAlias row. Throws HandleTakenError if the DB-level
   * `lower(alias)` unique index rejects the insert — closes the
   * check-then-act race against a concurrent claim of the same alias.
   */
  createPublicNickname(
    userId: string,
    alias: string,
  ): Promise<PublicNicknameRecord>;

  /**
   * Deletes the nickname if it is owned by userId. A no-op (no throw) when
   * the id does not exist or belongs to someone else — mirrors DELETE
   * idempotency elsewhere on this surface; removing a nickname moves no
   * money and changes none of the caller's own destinations (§3.1).
   */
  deletePublicNickname(userId: string, id: string): Promise<void>;

  /** Lists all public nicknames owned by the user, oldest first. */
  listPublicNicknames(userId: string): Promise<PublicNicknameRecord[]>;

  /** Reads User.payIdChangedAt (null = never changed). */
  getPayIdChangedAt(userId: string): Promise<Date | null>;

  /**
   * Sets User.payId + payIdChangedAt=now. Throws HandleTakenError if the
   * DB-level unique index rejects the update — closes the check-then-act
   * race against a concurrent claim of the same handle.
   */
  setPayId(userId: string, payId: string): Promise<void>;
}
