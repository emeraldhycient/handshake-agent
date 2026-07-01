import { ProviderTestResponseSchema } from "./providers-action.dto";

describe("ProviderTestResponseSchema", () => {
  it("parses a healthy probe with measured latency", () => {
    const parsed = ProviderTestResponseSchema.parse({
      key: "blockradar",
      result: "ok",
      latencyMs: 142,
      checkedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(parsed).toEqual({
      key: "blockradar",
      result: "ok",
      latencyMs: 142,
      checkedAt: "2026-07-01T00:00:00.000Z",
    });
  });

  it("parses a not_configured probe (no credential → no round-trip)", () => {
    const parsed = ProviderTestResponseSchema.parse({
      key: "resend",
      result: "not_configured",
      latencyMs: null,
      checkedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(parsed.result).toBe("not_configured");
    expect(parsed.latencyMs).toBeNull();
  });

  it("parses a mock probe (no-op success)", () => {
    const parsed = ProviderTestResponseSchema.parse({
      key: "flutterwave",
      result: "mock",
      latencyMs: null,
      checkedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(parsed.result).toBe("mock");
  });

  it("rejects an unknown probe result", () => {
    expect(() =>
      ProviderTestResponseSchema.parse({
        key: "x",
        result: "flaky",
        latencyMs: null,
        checkedAt: "2026-07-01T00:00:00.000Z",
      }),
    ).toThrow();
  });
});
