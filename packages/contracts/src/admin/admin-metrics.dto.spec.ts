import {
  MetricsRangeQuerySchema,
  MetricsBucketSchema,
  TxnCapabilityBucketSchema,
  TxnVolumeMetricsSchema,
  GmvMetricsSchema,
  RevenueMetricsSchema,
  MoneySeriesBucketSchema,
  MoneySeriesMetricsSchema,
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
    expect(MetricsBucketSchema.parse({ date: "2026-06-01", count: 4 })).toEqual(
      {
        date: "2026-06-01",
        count: 4,
      },
    );
  });
});

describe("TxnCapabilityBucketSchema", () => {
  it("parses a per-day stacked-by-capability bucket", () => {
    const value = TxnCapabilityBucketSchema.parse({
      date: "2026-06-01",
      buy: 3,
      sell: 1,
      send: 2,
      swap: 0,
      ticket: 1,
      total: 7,
    });
    expect(value.date).toBe("2026-06-01");
    expect(value.buy).toBe(3);
    expect(value.total).toBe(7);
  });

  it("rejects a bucket missing a capability segment", () => {
    expect(
      TxnCapabilityBucketSchema.safeParse({
        date: "2026-06-01",
        buy: 3,
        sell: 1,
        send: 2,
        swap: 0,
        total: 6,
      }).success,
    ).toBe(false);
  });
});

describe("TxnVolumeMetricsSchema", () => {
  it("parses byType rows (with a stuck sibling of failed), a series, a stacked series, and a successRate", () => {
    const value = TxnVolumeMetricsSchema.parse({
      byType: [{ type: "buy", count: 3, completed: 2, failed: 1, stuck: 0 }],
      series: [{ date: "2026-06-01", count: 3 }],
      stackedSeries: [
        {
          date: "2026-06-01",
          buy: 3,
          sell: 0,
          send: 0,
          swap: 0,
          ticket: 0,
          total: 3,
        },
      ],
      successRate: 0.6667,
    });
    expect(value.byType[0].type).toBe("buy");
    expect(value.byType[0].failed).toBe(1);
    expect(value.byType[0].stuck).toBe(0);
    expect(value.series).toHaveLength(1);
    expect(value.stackedSeries[0].buy).toBe(3);
    expect(value.successRate).toBeCloseTo(0.6667);
  });

  it("rejects a byType row missing the stuck count", () => {
    expect(
      TxnVolumeMetricsSchema.safeParse({
        byType: [{ type: "buy", count: 3, completed: 2, failed: 1 }],
        series: [],
        stackedSeries: [],
        successRate: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects a negative or non-integer stuck count", () => {
    expect(
      TxnVolumeMetricsSchema.safeParse({
        byType: [{ type: "buy", count: 3, completed: 2, failed: 1, stuck: -1 }],
        series: [],
        stackedSeries: [],
        successRate: 0,
      }).success,
    ).toBe(false);
    expect(
      TxnVolumeMetricsSchema.safeParse({
        byType: [
          { type: "buy", count: 3, completed: 2, failed: 1, stuck: 1.5 },
        ],
        series: [],
        stackedSeries: [],
        successRate: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects when the stacked series is missing", () => {
    expect(
      TxnVolumeMetricsSchema.safeParse({
        byType: [],
        series: [],
        successRate: 0,
      }).success,
    ).toBe(false);
  });
});

describe("GmvMetricsSchema", () => {
  it("keeps GMV amounts as strings (no float drift) and carries a txn count", () => {
    const value = GmvMetricsSchema.parse({
      totalByCurrency: [
        { currency: "NGN", amount: "1250000.000000000000000000" },
      ],
      txnCount: 42,
    });
    expect(value.totalByCurrency[0].currency).toBe("NGN");
    expect(value.totalByCurrency[0].amount).toBe("1250000.000000000000000000");
    expect(value.txnCount).toBe(42);
  });
});

describe("RevenueMetricsSchema", () => {
  it("keeps fee/spread/profit amounts as strings (no float drift)", () => {
    const value = RevenueMetricsSchema.parse({
      totalFeesByCurrency: [
        { currency: "NGN", amount: "150.000000000000000000" },
      ],
      totalSpreadByCurrency: [{ currency: "NGN", amount: "90" }],
      totalProfitByCurrency: [{ currency: "NGN", amount: "240" }],
      txnCount: 2,
    });
    expect(value.totalFeesByCurrency[0].amount).toBe("150.000000000000000000");
    expect(value.totalSpreadByCurrency[0].amount).toBe("90");
    expect(value.totalProfitByCurrency[0].amount).toBe("240");
    expect(value.txnCount).toBe(2);
  });
});

describe("MoneySeriesBucketSchema", () => {
  it("parses a per-day bucket with per-currency gmv/revenue/profit strings", () => {
    const value = MoneySeriesBucketSchema.parse({
      date: "2026-06-01",
      gmv: [{ currency: "NGN", amount: "50000" }],
      revenue: [{ currency: "NGN", amount: "150" }],
      profit: [{ currency: "NGN", amount: "240" }],
    });
    expect(value.date).toBe("2026-06-01");
    expect(value.gmv[0].amount).toBe("50000");
    expect(value.profit[0].currency).toBe("NGN");
  });

  it("rejects a bucket missing the profit array", () => {
    expect(
      MoneySeriesBucketSchema.safeParse({
        date: "2026-06-01",
        gmv: [],
        revenue: [],
      }).success,
    ).toBe(false);
  });
});

describe("MoneySeriesMetricsSchema", () => {
  it("parses sorted daily buckets plus the distinct currencies present", () => {
    const value = MoneySeriesMetricsSchema.parse({
      buckets: [
        {
          date: "2026-06-01",
          gmv: [{ currency: "NGN", amount: "50000" }],
          revenue: [{ currency: "NGN", amount: "150" }],
          profit: [{ currency: "NGN", amount: "240" }],
        },
      ],
      currencies: ["NGN"],
    });
    expect(value.buckets).toHaveLength(1);
    expect(value.currencies).toEqual(["NGN"]);
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
      txnVolume: { byType: [], series: [], stackedSeries: [], successRate: 0 },
      gmv: { totalByCurrency: [], txnCount: 0 },
      revenue: {
        totalFeesByCurrency: [],
        totalSpreadByCurrency: [],
        totalProfitByCurrency: [],
        txnCount: 0,
      },
      kycFunnel: { byStatus: [], byTier: [] },
      activeUsers: { activeInRange: 0, newInRange: 0, totalUsers: 0 },
      serviceHealth: { services: [] },
    });
    expect(value.txnVolume.successRate).toBe(0);
    expect(value.gmv.txnCount).toBe(0);
    expect(value.revenue.txnCount).toBe(0);
  });
});
