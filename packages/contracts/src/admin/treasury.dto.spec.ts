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
  TreasurySweepSchema,
  TreasurySweepListResponseSchema,
  TreasuryPayoutQueueItemSchema,
  TreasuryPayoutQueueResponseSchema,
  TreasuryFiatFloatSchema,
  TreasuryFiatFloatResponseSchema,
  TreasuryFxPositionSchema,
  TreasuryFxPositionResponseSchema,
} from "./treasury.dto";

const UUID = "11111111-1111-1111-1111-111111111111";
const WALLET_UUID = "22222222-2222-2222-2222-222222222222";
const TXN_UUID = "33333333-3333-3333-3333-333333333333";

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

describe("TreasurySweepSchema", () => {
  it("parses a sweep row with a valid status enum", () => {
    const parsed = TreasurySweepSchema.parse({
      id: WALLET_UUID,
      address: "TXsweepAddr000000000000000000000001",
      network: "TRON",
      asset: "TRX",
      balance: "18.400000",
      status: "below_threshold",
      lastSweptAt: null,
    });
    expect(parsed.status).toBe("below_threshold");
    expect(parsed.lastSweptAt).toBeNull();
  });

  it("rejects an out-of-vocabulary sweep status", () => {
    expect(() =>
      TreasurySweepSchema.parse({
        id: WALLET_UUID,
        address: "TXaddr",
        network: "TRON",
        asset: "TRX",
        balance: "1",
        status: "flushed",
        lastSweptAt: null,
      }),
    ).toThrow();
  });

  it("rejects a numeric balance (must be a byte-stable string)", () => {
    expect(() =>
      TreasurySweepSchema.parse({
        id: WALLET_UUID,
        address: "TXaddr",
        network: "TRON",
        asset: "TRX",
        balance: 18.4,
        status: "swept",
        lastSweptAt: null,
      }),
    ).toThrow();
  });

  it("wraps sweeps in { items, sweepThreshold, thresholdAsset }", () => {
    const res = TreasurySweepListResponseSchema.parse({
      items: [
        {
          id: WALLET_UUID,
          address: "TXaddr",
          network: "TRON",
          asset: "TRX",
          balance: "30",
          status: "swept",
          lastSweptAt: "2026-06-30T00:00:00.000Z",
        },
      ],
      sweepThreshold: "25",
      thresholdAsset: "TRX",
    });
    expect(res.items).toHaveLength(1);
    expect(res.sweepThreshold).toBe("25");
    expect(res.thresholdAsset).toBe("TRX");
  });
});

describe("TreasuryPayoutQueueItemSchema", () => {
  it("parses a pending-payout row with a nullable fiatAmount", () => {
    const parsed = TreasuryPayoutQueueItemSchema.parse({
      id: UUID,
      transactionId: TXN_UUID,
      beneficiaryLabel: "Kelechi Chukwu · GTBank",
      reference: "wd_44219",
      method: "NGN payout · Flutterwave",
      asset: "NGN",
      amount: "4820000.00",
      fiatAmount: null,
      fiatCurrency: "NGN",
      requiresApproval: true,
      submittedAt: "2026-06-30T00:00:00.000Z",
    });
    expect(parsed.requiresApproval).toBe(true);
    expect(parsed.fiatAmount).toBeNull();
    expect(parsed.fiatCurrency).toBe("NGN");
  });

  it("requires fiatCurrency (the approval gate compares in the payout's own currency)", () => {
    expect(() =>
      TreasuryPayoutQueueItemSchema.parse({
        id: UUID,
        transactionId: TXN_UUID,
        beneficiaryLabel: "x",
        reference: "wd_1",
        method: "USDT · Blockradar",
        asset: "USDT",
        amount: "1250",
        fiatAmount: "2000000.00",
        requiresApproval: true,
        submittedAt: "2026-06-30T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects a numeric amount (must be a byte-stable string)", () => {
    expect(() =>
      TreasuryPayoutQueueItemSchema.parse({
        id: UUID,
        transactionId: TXN_UUID,
        beneficiaryLabel: "x",
        reference: "wd_1",
        method: "USDT · Blockradar",
        asset: "USDT",
        amount: 1250,
        fiatAmount: null,
        fiatCurrency: "GHS",
        requiresApproval: false,
        submittedAt: "2026-06-30T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("wraps payout rows in { items }", () => {
    const res = TreasuryPayoutQueueResponseSchema.parse({ items: [] });
    expect(res.items).toEqual([]);
  });
});

describe("TreasuryFiatFloatSchema", () => {
  it("parses a fiat-float row with a valid status enum", () => {
    const parsed = TreasuryFiatFloatSchema.parse({
      currency: "NGN",
      balance: "42180500.00",
      targetFloat: "234000000.00",
      utilizationBps: 1802,
      status: "low",
      lowFloatThresholdBps: 2500,
    });
    expect(parsed.status).toBe("low");
    expect(parsed.utilizationBps).toBe(1802);
  });

  it("rejects an out-of-vocabulary float status", () => {
    expect(() =>
      TreasuryFiatFloatSchema.parse({
        currency: "NGN",
        balance: "1",
        targetFloat: "1",
        utilizationBps: 0,
        status: "drained",
        lowFloatThresholdBps: 2500,
      }),
    ).toThrow();
  });

  it("wraps fiat floats in { items }", () => {
    const res = TreasuryFiatFloatResponseSchema.parse({ items: [] });
    expect(res.items).toEqual([]);
  });
});

describe("TreasuryFxPositionSchema", () => {
  it("parses an FX-position row with direction + headroom", () => {
    const parsed = TreasuryFxPositionSchema.parse({
      asset: "USDT",
      fiatCurrency: "NGN",
      netPositionFiat: "8240.00",
      direction: "long",
      headroomBps: 7200,
      exposureStatus: "safe",
    });
    expect(parsed.direction).toBe("long");
    expect(parsed.headroomBps).toBe(7200);
    expect(parsed.exposureStatus).toBe("safe");
  });

  it("rejects an out-of-vocabulary direction", () => {
    expect(() =>
      TreasuryFxPositionSchema.parse({
        asset: "USDT",
        fiatCurrency: "NGN",
        netPositionFiat: "0",
        direction: "sideways",
        headroomBps: 0,
        exposureStatus: "safe",
      }),
    ).toThrow();
  });

  it("wraps FX positions in { items }", () => {
    const res = TreasuryFxPositionResponseSchema.parse({ items: [] });
    expect(res.items).toEqual([]);
  });
});
