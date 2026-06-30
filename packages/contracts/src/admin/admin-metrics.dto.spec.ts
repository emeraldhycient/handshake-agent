import {
  MetricsRangeQuerySchema,
  MetricsBucketSchema,
  TxnVolumeMetricsSchema,
  RevenueMetricsSchema,
  KycFunnelMetricsSchema,
  ActiveUsersMetricsSchema,
  ServiceHealthMetricsSchema,
  DashboardSummarySchema,
} from "./admin-metrics.dto";

describe("MetricsRangeQuerySchema", () => {
  it("accepts both bounds omitted (service defaults to last 30 days)", () => {
    expect(MetricsRangeQuerySchema.parse({})).toEqual({});
  });

  it("accepts ISO date strings for from/to", () => {
    const parsed = MetricsRangeQuerySchema.parse({
      from: "2026-06-01",
      to: "2026-06-30",
    });
    expect(parsed.from).toBe("2026-06-01");
    expect(parsed.to).toBe("2026-06-30");
  });
});

describe("MetricsBucketSchema", () => {
  it("parses a date + count bucket", () => {
    expect(MetricsBucketSchema.parse({ date: "2026-06-01", count: 4 })).toEqual({
      date: "2026-06-01",
      count: 4,
    });
  });
});

describe("TxnVolumeMetricsSchema", () => {
  it("parses byType rows, a series, and a successRate", () => {
    const value = TxnVolumeMetricsSchema.parse({
      byType: [{ type: "buy", count: 3, completed: 2, failed: 1 }],
      series: [{ date: "2026-06-01", count: 3 }],
      successRate: 0.6667,
    });
    expect(value.byType[0].type).toBe("buy");
    expect(value.series).toHaveLength(1);
    expect(value.successRate).toBeCloseTo(0.6667);
  });
});

describe("RevenueMetricsSchema", () => {
  it("keeps fee/spread amounts as strings (no float drift)", () => {
    const value = RevenueMetricsSchema.parse({
      totalFeesByCurrency: [{ currency: "NGN", amount: "150.000000000000000000" }],
      totalSpreadByCurrency: [],
      txnCount: 2,
    });
    expect(value.totalFeesByCurrency[0].amount).toBe(
      "150.000000000000000000",
    );
    expect(value.totalSpreadByCurrency).toEqual([]);
    expect(value.txnCount).toBe(2);
  });
});

describe("KycFunnelMetricsSchema", () => {
  it("parses byStatus + byTier counts", () => {
    const value = KycFunnelMetricsSchema.parse({
      byStatus: [{ status: "verified", count: 5 }],
      byTier: [{ tier: "tier_1", count: 3 }],
    });
    expect(value.byStatus[0].status).toBe("verified");
    expect(value.byTier[0].tier).toBe("tier_1");
  });
});

describe("ActiveUsersMetricsSchema", () => {
  it("parses active/new/total user counts", () => {
    expect(
      ActiveUsersMetricsSchema.parse({
        activeInRange: 4,
        newInRange: 2,
        totalUsers: 10,
      }),
    ).toEqual({ activeInRange: 4, newInRange: 2, totalUsers: 10 });
  });
});

describe("ServiceHealthMetricsSchema", () => {
  it("parses per-service health rows", () => {
    const value = ServiceHealthMetricsSchema.parse({
      services: [
        {
          service: "buy",
          total: 3,
          completed: 2,
          failed: 1,
          successRate: 0.6667,
        },
      ],
    });
    expect(value.services[0].service).toBe("buy");
    expect(value.services[0].total).toBe(3);
  });
});

describe("DashboardSummarySchema", () => {
  it("parses the composite dashboard payload", () => {
    const value = DashboardSummarySchema.parse({
      txnVolume: { byType: [], series: [], successRate: 0 },
      revenue: { totalFeesByCurrency: [], totalSpreadByCurrency: [], txnCount: 0 },
      kycFunnel: { byStatus: [], byTier: [] },
      activeUsers: { activeInRange: 0, newInRange: 0, totalUsers: 0 },
      serviceHealth: { services: [] },
    });
    expect(value.txnVolume.successRate).toBe(0);
    expect(value.revenue.txnCount).toBe(0);
  });
});
