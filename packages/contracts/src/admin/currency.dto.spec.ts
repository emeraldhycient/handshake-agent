import {
  AdminCustomFiatCreateRequestSchema,
  AdminCustomFiatListResponseSchema,
  AdminCustomFiatSchema,
  AdminCustomFiatUpdateRequestSchema,
} from "./currency.dto";

/**
 * Parse fixtures for the admin "Add currency" contract (CLAUDE.md §7 layered config).
 *
 * These four schemas are the single shape shared by three consumers: the api ingress
 * DTOs (`AdminCustomFiatCreateDto` / `AdminCustomFiatUpdateDto` via `createZodDto`),
 * the api controller's response projection, and the web-admin client
 * (`web-admin/lib/api/currencies.ts` parses request bodies out and responses back in).
 *
 * Adding a currency moves no money, but the code it accepts is fed straight into the
 * server-side collision and fail-closed pricing gates in `AdminCurrencyService` — so
 * the cases below pin the boundary behavior those gates depend on.
 */

describe("AdminCustomFiatCreateRequestSchema", () => {
  const valid = {
    code: "GHS",
    displayName: "Ghanaian Cedi",
    symbol: "GH₵",
    decimals: 2,
  };

  it("accepts a well-formed create request", () => {
    expect(AdminCustomFiatCreateRequestSchema.parse(valid)).toEqual(valid);
  });

  it("trims surrounding whitespace on the code", () => {
    // The trimmed value is what reaches AdminCurrencyService's collision checks
    // (`registry.supportedFiats().includes(code)` and `repo.findByCode(code)`),
    // so " GHS " and "GHS" must resolve to the same currency.
    expect(
      AdminCustomFiatCreateRequestSchema.parse({ ...valid, code: "  GHS  " })
        .code,
    ).toBe("GHS");
  });

  it("rejects a lowercase code", () => {
    // Shadow-currency guard: the built-in collision check is case-sensitive, so a
    // lowercase "ngn" would slip past `supportedFiats().includes("NGN")` and create
    // a custom fiat shadowing a platform currency. Uppercase is enforced here.
    expect(
      AdminCustomFiatCreateRequestSchema.safeParse({ ...valid, code: "ngn" })
        .success,
    ).toBe(false);
  });

  it("rejects a code that is not exactly three letters", () => {
    for (const code of ["GH", "GHSD", "G1S", "GH-"]) {
      expect(
        AdminCustomFiatCreateRequestSchema.safeParse({ ...valid, code })
          .success,
      ).toBe(false);
    }
  });

  it("accepts the decimals bounds (0 and 8)", () => {
    // 0 covers zero-decimal currencies (JPY-style); 8 is the upper bound.
    expect(
      AdminCustomFiatCreateRequestSchema.parse({ ...valid, decimals: 0 })
        .decimals,
    ).toBe(0);
    expect(
      AdminCustomFiatCreateRequestSchema.parse({ ...valid, decimals: 8 })
        .decimals,
    ).toBe(8);
  });

  it("rejects decimals outside 0–8, and non-integer decimals", () => {
    for (const decimals of [-1, 9, 2.5]) {
      expect(
        AdminCustomFiatCreateRequestSchema.safeParse({ ...valid, decimals })
          .success,
      ).toBe(false);
    }
  });

  it("accepts displayName and symbol at their length bounds", () => {
    expect(
      AdminCustomFiatCreateRequestSchema.safeParse({
        ...valid,
        displayName: "x".repeat(60),
        symbol: "x".repeat(8),
      }).success,
    ).toBe(true);
  });

  it("rejects an empty or over-long displayName", () => {
    for (const displayName of ["", "x".repeat(61)]) {
      expect(
        AdminCustomFiatCreateRequestSchema.safeParse({ ...valid, displayName })
          .success,
      ).toBe(false);
    }
  });

  it("rejects an empty or over-long symbol", () => {
    for (const symbol of ["", "x".repeat(9)]) {
      expect(
        AdminCustomFiatCreateRequestSchema.safeParse({ ...valid, symbol })
          .success,
      ).toBe(false);
    }
  });

  it("rejects a request missing any required field", () => {
    for (const key of Object.keys(valid)) {
      const { [key]: _removed, ...rest } = valid as Record<string, unknown>;
      expect(AdminCustomFiatCreateRequestSchema.safeParse(rest).success).toBe(
        false,
      );
    }
  });

  it("strips an `enabled` key rather than honoring it", () => {
    // A currency is always created DISABLED and only goes live through the
    // fail-closed enable path, so `enabled` is not part of the create contract.
    expect(
      AdminCustomFiatCreateRequestSchema.parse({ ...valid, enabled: true }),
    ).toEqual(valid);
  });
});

describe("AdminCustomFiatUpdateRequestSchema", () => {
  it("accepts an enable-only patch", () => {
    expect(AdminCustomFiatUpdateRequestSchema.parse({ enabled: true })).toEqual(
      {
        enabled: true,
      },
    );
  });

  it("accepts a disable-only patch", () => {
    // Disabling deliberately skips the pricing gate that enabling must clear.
    expect(
      AdminCustomFiatUpdateRequestSchema.parse({ enabled: false }),
    ).toEqual({ enabled: false });
  });

  it("accepts a metadata-only patch and a full patch", () => {
    expect(
      AdminCustomFiatUpdateRequestSchema.safeParse({ displayName: "Cedi" })
        .success,
    ).toBe(true);
    expect(
      AdminCustomFiatUpdateRequestSchema.safeParse({
        enabled: true,
        displayName: "Cedi",
        symbol: "₵",
        decimals: 2,
      }).success,
    ).toBe(true);
  });

  it("rejects an empty patch", () => {
    // AdminCurrencyService audits every update; an empty patch would write an
    // audit record describing no change.
    expect(AdminCustomFiatUpdateRequestSchema.safeParse({}).success).toBe(
      false,
    );
  });

  it("rejects a patch containing only unknown keys", () => {
    // Unknown keys are stripped BEFORE the "at least one field" refinement runs,
    // so a typo'd field name fails loudly instead of becoming a silent no-op write.
    expect(
      AdminCustomFiatUpdateRequestSchema.safeParse({ enable: true }).success,
    ).toBe(false);
  });

  it("strips unknown keys alongside a valid field", () => {
    expect(
      AdminCustomFiatUpdateRequestSchema.parse({ enabled: true, foo: "bar" }),
    ).toEqual({ enabled: true });
  });

  it("rejects wrong types and out-of-bounds decimals", () => {
    expect(
      AdminCustomFiatUpdateRequestSchema.safeParse({ enabled: "true" }).success,
    ).toBe(false);
    expect(
      AdminCustomFiatUpdateRequestSchema.safeParse({ displayName: "" }).success,
    ).toBe(false);
    expect(
      AdminCustomFiatUpdateRequestSchema.safeParse({ decimals: 9 }).success,
    ).toBe(false);
  });
});

describe("AdminCustomFiatSchema", () => {
  const valid = {
    code: "GHS",
    displayName: "Ghanaian Cedi",
    symbol: "GH₵",
    decimals: 2,
    enabled: false,
    createdAt: "2026-07-19T00:00:00.000Z",
  };

  it("accepts a well-formed persisted currency", () => {
    expect(AdminCustomFiatSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a date-only createdAt", () => {
    // The service projects `row.createdAt.toISOString()` into this field, so a
    // bare calendar date is not a valid wire value.
    expect(
      AdminCustomFiatSchema.safeParse({ ...valid, createdAt: "2026-07-19" })
        .success,
    ).toBe(false);
  });

  it("carries a plain-string code, unlike the create request", () => {
    // Deliberate asymmetry: the response echoes an already-validated persisted row,
    // so it does not re-apply the 3-letter uppercase check that guards ingress.
    expect(
      AdminCustomFiatSchema.safeParse({ ...valid, code: "ghs" }).success,
    ).toBe(true);
  });

  it("rejects negative or non-integer decimals", () => {
    for (const decimals of [-1, 2.5]) {
      expect(
        AdminCustomFiatSchema.safeParse({ ...valid, decimals }).success,
      ).toBe(false);
    }
  });

  it("rejects a row missing any required field", () => {
    for (const key of Object.keys(valid)) {
      const { [key]: _removed, ...rest } = valid as Record<string, unknown>;
      expect(AdminCustomFiatSchema.safeParse(rest).success).toBe(false);
    }
  });
});

describe("AdminCustomFiatListResponseSchema", () => {
  const row = {
    code: "GHS",
    displayName: "Ghanaian Cedi",
    symbol: "GH₵",
    decimals: 2,
    enabled: false,
    createdAt: "2026-07-19T00:00:00.000Z",
  };

  it("accepts an empty list", () => {
    // The web-admin currencies table renders an explicit empty branch off this.
    expect(AdminCustomFiatListResponseSchema.parse({ items: [] })).toEqual({
      items: [],
    });
  });

  it("accepts a populated list", () => {
    expect(
      AdminCustomFiatListResponseSchema.parse({ items: [row] }).items,
    ).toHaveLength(1);
  });

  it("rejects a bare array (the response is wrapped in `items`)", () => {
    expect(AdminCustomFiatListResponseSchema.safeParse([row]).success).toBe(
      false,
    );
  });

  it("rejects a list containing a malformed row", () => {
    expect(
      AdminCustomFiatListResponseSchema.safeParse({
        items: [row, { ...row, createdAt: "not-a-date" }],
      }).success,
    ).toBe(false);
  });
});
