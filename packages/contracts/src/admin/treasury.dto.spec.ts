import {
  TreasuryBalanceSchema,
  TreasuryBalancesResponseSchema,
  TreasuryExposureSchema,
  TreasuryExposureListResponseSchema,
  TreasuryAlertSchema,
  TreasuryAlertListResponseSchema,
  TreasuryAlertAcknowledgeRequestSchema,
  WithdrawalPolicySchema,
  WithdrawalPolicyListResponseSchema,
} from "./treasury.dto";

const UUID = "11111111-1111-1111-1111-111111111111";
const WALLET_UUID = "22222222-2222-2222-2222-222222222222";

describe("TreasuryBalanceSchema", () => {
  it("parses an aggregated balance row (amount is a string)", () => {
    const parsed = TreasuryBalanceSchema.parse({
      network: "TRON",
      asset: "USDT",
      totalAmount: "12345.678901",
      walletCount: 7,
    });
    expect(parsed.totalAmount).toBe("12345.678901");
    expect(parsed.walletCount).toBe(7);
  });

  it("rejects a numeric totalAmount (must be a byte-stable string)", () => {
    expect(() =>
      TreasuryBalanceSchema.parse({
        network: "TRON",
        asset: "USDT",
        totalAmount: 12345,
        walletCount: 1,
      }),
    ).toThrow();
  });

  it("wraps balances in { balances }", () => {
    const res = TreasuryBalancesResponseSchema.parse({
      balances: [
        { network: "TRON", asset: "USDT", totalAmount: "1", walletCount: 1 },
      ],
    });
    expect(res.balances).toHaveLength(1);
  });
});

describe("TreasuryExposureSchema", () => {
  it("parses an exposure row with a valid status enum", () => {
    const parsed = TreasuryExposureSchema.parse({
      id: UUID,
      asset: "USDT",
      fiatCurrency: "NGN",
      cryptoHeld: "1000",
      fiatEquivalent: "1600000.00",
      netExposure: "1600000.00",
      exposureLimitBps: 500,
      status: "warning",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.status).toBe("warning");
  });

  it("rejects an out-of-vocabulary status", () => {
    expect(() =>
      TreasuryExposureSchema.parse({
        id: UUID,
        asset: "USDT",
        fiatCurrency: "NGN",
        cryptoHeld: "1000",
        fiatEquivalent: "1",
        netExposure: "1",
        exposureLimitBps: 500,
        status: "exploded",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("wraps exposures in { items }", () => {
    const res = TreasuryExposureListResponseSchema.parse({ items: [] });
    expect(res.items).toEqual([]);
  });
});

describe("TreasuryAlertSchema", () => {
  it("parses an alert with a nullable acknowledgedAt", () => {
    const parsed = TreasuryAlertSchema.parse({
      id: UUID,
      asset: "USDT",
      severity: "critical",
      message: "Exposure breached the critical threshold",
      netExposure: "1600000.00",
      triggeredAt: "2026-01-01T00:00:00.000Z",
      acknowledgedAt: null,
    });
    expect(parsed.acknowledgedAt).toBeNull();
    expect(parsed.severity).toBe("critical");
  });

  it("accepts an acknowledged alert (acknowledgedAt set)", () => {
    const parsed = TreasuryAlertSchema.parse({
      id: UUID,
      asset: "USDT",
      severity: "info",
      message: "ok",
      netExposure: "1",
      triggeredAt: "2026-01-01T00:00:00.000Z",
      acknowledgedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(parsed.acknowledgedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("wraps alerts in { items }", () => {
    const res = TreasuryAlertListResponseSchema.parse({ items: [] });
    expect(res.items).toEqual([]);
  });

  it("acknowledge request allows an optional note", () => {
    expect(TreasuryAlertAcknowledgeRequestSchema.parse({})).toEqual({});
    expect(
      TreasuryAlertAcknowledgeRequestSchema.parse({ note: "reviewed" }).note,
    ).toBe("reviewed");
  });
});

describe("WithdrawalPolicySchema", () => {
  it("parses a policy with nullable caps", () => {
    const parsed = WithdrawalPolicySchema.parse({
      id: UUID,
      walletId: WALLET_UUID,
      maxWithdrawalPerTx: null,
      maxWithdrawalPerDay: "5000",
      requiresApproval: true,
      allowListMode: "allow_list_only",
      enabledAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.maxWithdrawalPerTx).toBeNull();
    expect(parsed.maxWithdrawalPerDay).toBe("5000");
    expect(parsed.requiresApproval).toBe(true);
  });

  it("wraps policies in { items }", () => {
    const res = WithdrawalPolicyListResponseSchema.parse({ items: [] });
    expect(res.items).toEqual([]);
  });
});
