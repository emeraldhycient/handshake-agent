import { describe, it, expect } from "vitest";
import {
  PAT_TOKEN_PREFIX,
  PatScopeSchema,
  CreatePatRequestSchema,
  CreatePatResponseSchema,
  PatListItemSchema,
  PatListResponseSchema,
} from "./pat.dto";

describe("PatScopeSchema", () => {
  it("accepts the two defined scopes", () => {
    expect(PatScopeSchema.parse("read")).toBe("read");
    expect(PatScopeSchema.parse("chat:propose")).toBe("chat:propose");
  });

  it("rejects unknown scopes (no execute scope exists on this surface)", () => {
    expect(() => PatScopeSchema.parse("chat:execute")).toThrow();
    expect(() => PatScopeSchema.parse("admin")).toThrow();
  });
});

describe("CreatePatRequestSchema", () => {
  it("parses a full request", () => {
    const out = CreatePatRequestSchema.parse({
      label: "Claude Desktop",
      pin: "8047",
      scopes: ["read", "chat:propose"],
      expiresInDays: 90,
    });
    expect(out.scopes).toEqual(["read", "chat:propose"]);
    expect(out.expiresInDays).toBe(90);
  });

  it("defaults scopes to ['read'] when omitted", () => {
    const out = CreatePatRequestSchema.parse({
      label: "Read-only agent",
      pin: "8047",
    });
    expect(out.scopes).toEqual(["read"]);
    expect(out.expiresInDays).toBeUndefined();
  });

  it("rejects an empty label, empty scopes and a missing pin", () => {
    expect(() =>
      CreatePatRequestSchema.parse({ label: "  ", pin: "8047" }),
    ).toThrow();
    expect(() =>
      CreatePatRequestSchema.parse({ label: "x", pin: "8047", scopes: [] }),
    ).toThrow();
    expect(() => CreatePatRequestSchema.parse({ label: "x" })).toThrow();
  });

  it("rejects out-of-range expiresInDays", () => {
    expect(() =>
      CreatePatRequestSchema.parse({ label: "x", pin: "1", expiresInDays: 0 }),
    ).toThrow();
    expect(() =>
      CreatePatRequestSchema.parse({
        label: "x",
        pin: "1",
        expiresInDays: 3.5,
      }),
    ).toThrow();
    expect(() =>
      CreatePatRequestSchema.parse({
        label: "x",
        pin: "1",
        expiresInDays: 3651,
      }),
    ).toThrow();
  });
});

describe("CreatePatResponseSchema", () => {
  it("parses the mint response carrying the raw token once", () => {
    const ok = {
      id: "018f6b3a-0000-7000-8000-000000000001",
      label: "Claude Desktop",
      scopes: ["read"],
      token: `${PAT_TOKEN_PREFIX}${"ab".repeat(32)}`,
      createdAt: "2026-07-08T10:00:00.000Z",
      expiresAt: null,
    };
    expect(CreatePatResponseSchema.parse(ok)).toEqual(ok);
  });

  it("rejects a token without the hsk_pat_ prefix", () => {
    expect(() =>
      CreatePatResponseSchema.parse({
        id: "018f6b3a-0000-7000-8000-000000000001",
        label: "x",
        scopes: ["read"],
        token: "ab".repeat(32),
        createdAt: "2026-07-08T10:00:00.000Z",
        expiresAt: null,
      }),
    ).toThrow();
  });
});

describe("PatListItemSchema / PatListResponseSchema", () => {
  it("parses a masked list item (never carries the token or its hash)", () => {
    const ok = {
      id: "018f6b3a-0000-7000-8000-000000000001",
      label: "Claude Desktop",
      scopes: ["read", "chat:propose"],
      createdAt: "2026-07-08T10:00:00.000Z",
      lastUsedAt: null,
      expiresAt: "2026-10-08T10:00:00.000Z",
    };
    expect(PatListItemSchema.parse(ok)).toEqual(ok);
    expect(PatListResponseSchema.parse({ tokens: [ok] }).tokens).toHaveLength(
      1,
    );
  });

  it("strips unknown keys so a leaked tokenHash cannot pass through", () => {
    const parsed = PatListItemSchema.parse({
      id: "018f6b3a-0000-7000-8000-000000000001",
      label: "x",
      scopes: ["read"],
      createdAt: "2026-07-08T10:00:00.000Z",
      lastUsedAt: null,
      expiresAt: null,
      tokenHash: "deadbeef",
    });
    expect(parsed).not.toHaveProperty("tokenHash");
  });
});
