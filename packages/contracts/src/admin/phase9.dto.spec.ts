import {
  AdminBeneficiaryRemoveRequestSchema,
  AdminUserSessionRevokeRequestSchema,
  ForceReKycRequestSchema,
  KycRequestInfoRequestSchema,
  ResendVerificationRequestSchema,
  AdminUserNoteCreateRequestSchema,
  AdminUserNoteSchema,
  AdminUserNoteListResponseSchema,
  BlockedEntryKindSchema,
  BlockedEntrySchema,
  BlockedEntryListResponseSchema,
  BlockedEntryCreateRequestSchema,
  BlockedEntrySupersedeRequestSchema,
} from "./phase9.dto";

// The reason-carrying WRITE requests share one shape: reason min 3 / max 500.
// Each is its own named schema so the API + web-admin bind to a distinct DTO per
// endpoint (§8), but they enforce the same audited-justification bounds.
describe("reason-carrying Phase 9 request schemas (min 3 / max 500)", () => {
  const reasonSchemas = [
    ["AdminBeneficiaryRemoveRequestSchema", AdminBeneficiaryRemoveRequestSchema],
    ["AdminUserSessionRevokeRequestSchema", AdminUserSessionRevokeRequestSchema],
    ["ForceReKycRequestSchema", ForceReKycRequestSchema],
    ["KycRequestInfoRequestSchema", KycRequestInfoRequestSchema],
    ["BlockedEntrySupersedeRequestSchema", BlockedEntrySupersedeRequestSchema],
  ] as const;

  for (const [name, schema] of reasonSchemas) {
    describe(name, () => {
      it("accepts a valid reason", () => {
        const parsed = schema.parse({ reason: "SIM-swap detected; forcing re-KYC." });
        expect(parsed.reason).toContain("KYC");
      });

      it("rejects a reason shorter than 3 characters (audit must carry justification)", () => {
        expect(() => schema.parse({ reason: "no" })).toThrow();
        expect(() => schema.parse({ reason: "" })).toThrow();
      });

      it("rejects a reason longer than 500 characters", () => {
        expect(() => schema.parse({ reason: "x".repeat(501) })).toThrow();
      });

      it("rejects a missing reason", () => {
        expect(() => schema.parse({})).toThrow();
      });
    });
  }
});

describe("ResendVerificationRequestSchema", () => {
  it("accepts a present reason", () => {
    const parsed = ResendVerificationRequestSchema.parse({
      reason: "User reported the email never arrived.",
    });
    expect(parsed.reason).toContain("email");
  });

  it("accepts an omitted reason (optional)", () => {
    const parsed = ResendVerificationRequestSchema.parse({});
    expect(parsed.reason).toBeUndefined();
  });

  it("rejects a reason longer than 500 characters", () => {
    expect(() =>
      ResendVerificationRequestSchema.parse({ reason: "x".repeat(501) }),
    ).toThrow();
  });
});

describe("AdminUserNoteCreateRequestSchema", () => {
  it("accepts a non-empty body", () => {
    const parsed = AdminUserNoteCreateRequestSchema.parse({
      body: "Called the user to verify beneficiary; confirmed legitimate.",
    });
    expect(parsed.body).toContain("beneficiary");
  });

  it("rejects an empty body", () => {
    expect(() => AdminUserNoteCreateRequestSchema.parse({ body: "" })).toThrow();
  });

  it("rejects a body longer than 2000 characters", () => {
    expect(() =>
      AdminUserNoteCreateRequestSchema.parse({ body: "x".repeat(2001) }),
    ).toThrow();
  });
});

describe("AdminUserNoteSchema / AdminUserNoteListResponseSchema", () => {
  const note = {
    id: "note-1",
    body: "Verified identity over the phone.",
    authorAdminId: "adm-9",
    createdAt: "2026-07-03T10:00:00.000Z",
  };

  it("parses a well-formed note", () => {
    expect(AdminUserNoteSchema.parse(note)).toEqual(note);
  });

  it("rejects a non-ISO createdAt", () => {
    expect(() =>
      AdminUserNoteSchema.parse({ ...note, createdAt: "not-a-date" }),
    ).toThrow();
  });

  it("parses a list response of notes", () => {
    const parsed = AdminUserNoteListResponseSchema.parse({ items: [note] });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].authorAdminId).toBe("adm-9");
  });

  it("parses an empty list", () => {
    expect(AdminUserNoteListResponseSchema.parse({ items: [] })).toEqual({
      items: [],
    });
  });
});

describe("BlockedEntryKindSchema", () => {
  it("accepts each supported kind", () => {
    expect(BlockedEntryKindSchema.parse("user")).toBe("user");
    expect(BlockedEntryKindSchema.parse("address")).toBe("address");
    expect(BlockedEntryKindSchema.parse("bank")).toBe("bank");
  });

  it("rejects an unknown kind", () => {
    expect(() => BlockedEntryKindSchema.parse("phone")).toThrow();
  });
});

describe("BlockedEntrySchema / BlockedEntryListResponseSchema", () => {
  const active = {
    id: "blk-1",
    kind: "address" as const,
    value: "TXYZ...abc",
    reason: "Sanctions match; blocked pending review.",
    addedByAdminId: "adm-3",
    createdAt: "2026-07-03T09:00:00.000Z",
    supersededAt: null,
  };

  it("parses an active blocked entry (supersededAt null)", () => {
    expect(BlockedEntrySchema.parse(active)).toEqual(active);
  });

  it("parses a superseded blocked entry (supersededAt iso)", () => {
    const superseded = {
      ...active,
      supersededAt: "2026-07-04T09:00:00.000Z",
    };
    expect(BlockedEntrySchema.parse(superseded).supersededAt).toBe(
      "2026-07-04T09:00:00.000Z",
    );
  });

  it("rejects a non-ISO createdAt", () => {
    expect(() =>
      BlockedEntrySchema.parse({ ...active, createdAt: "yesterday" }),
    ).toThrow();
  });

  it("rejects a non-ISO supersededAt when present", () => {
    expect(() =>
      BlockedEntrySchema.parse({ ...active, supersededAt: "soon" }),
    ).toThrow();
  });

  it("parses a list response", () => {
    const parsed = BlockedEntryListResponseSchema.parse({ items: [active] });
    expect(parsed.items[0].kind).toBe("address");
  });
});

describe("BlockedEntryCreateRequestSchema", () => {
  it("accepts a well-formed create request", () => {
    const parsed = BlockedEntryCreateRequestSchema.parse({
      kind: "bank",
      value: "0123456789",
      reason: "Mule account reported by partner bank.",
    });
    expect(parsed.kind).toBe("bank");
    expect(parsed.value).toBe("0123456789");
  });

  it("rejects an empty value", () => {
    expect(() =>
      BlockedEntryCreateRequestSchema.parse({
        kind: "user",
        value: "",
        reason: "valid reason here",
      }),
    ).toThrow();
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      BlockedEntryCreateRequestSchema.parse({
        kind: "device",
        value: "abc",
        reason: "valid reason here",
      }),
    ).toThrow();
  });

  it("rejects a reason shorter than 3 characters", () => {
    expect(() =>
      BlockedEntryCreateRequestSchema.parse({
        kind: "user",
        value: "usr-1",
        reason: "x",
      }),
    ).toThrow();
  });

  it("rejects a reason longer than 500 characters", () => {
    expect(() =>
      BlockedEntryCreateRequestSchema.parse({
        kind: "user",
        value: "usr-1",
        reason: "x".repeat(501),
      }),
    ).toThrow();
  });
});
