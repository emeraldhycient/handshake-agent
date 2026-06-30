import {
  AdminSessionViewSchema,
  AdminSessionListResponseSchema,
} from "./session.dto";

describe("AdminSessionViewSchema", () => {
  it("parses a metadata-only session view", () => {
    const parsed = AdminSessionViewSchema.parse({
      id: "11111111-1111-1111-1111-111111111111",
      expiresAt: "2026-07-01T00:00:00.000Z",
      revokedAt: null,
      stepUpCompletedAt: null,
      ipAddress: "1.2.3.4",
      userAgent: "jest",
    });
    expect(parsed.ipAddress).toBe("1.2.3.4");
  });

  it("rejects a payload carrying a tokenHash (must never be surfaced)", () => {
    const ok = AdminSessionListResponseSchema.parse({
      items: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          expiresAt: "2026-07-01T00:00:00.000Z",
          revokedAt: null,
          stepUpCompletedAt: "2026-06-30T12:00:00.000Z",
          ipAddress: null,
          userAgent: null,
          // extra keys are stripped by zod object parsing
          tokenHash: "should-be-stripped",
        },
      ],
    });
    expect(
      (ok.items[0] as Record<string, unknown>).tokenHash,
    ).toBeUndefined();
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      AdminSessionViewSchema.parse({
        id: "not-a-uuid",
        expiresAt: "2026-07-01T00:00:00.000Z",
        revokedAt: null,
        stepUpCompletedAt: null,
        ipAddress: null,
        userAgent: null,
      }),
    ).toThrow();
  });
});
