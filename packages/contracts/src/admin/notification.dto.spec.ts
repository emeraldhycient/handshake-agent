import {
  NotificationChannelSchema,
  TemplateVariableSchema,
  NotificationTemplateSchema,
  NotificationTemplateListResponseSchema,
  NotificationTemplateUpsertRequestSchema,
  NotificationTemplatePreviewRequestSchema,
  NotificationTemplatePreviewResponseSchema,
  DeliveryLogStatusSchema,
  DeliveryLogEntrySchema,
  DeliveryStatsSchema,
  DeliveryLogResponseSchema,
} from "./notification.dto";

describe("NotificationChannelSchema", () => {
  it("accepts the four delivery channels", () => {
    for (const c of ["whatsapp", "email", "sms", "in_app"] as const) {
      expect(NotificationChannelSchema.parse(c)).toBe(c);
    }
  });

  it("rejects an unmodelled channel", () => {
    expect(() => NotificationChannelSchema.parse("web")).toThrow();
    expect(() => NotificationChannelSchema.parse("push")).toThrow();
  });
});

describe("TemplateVariableSchema", () => {
  it("accepts a well-formed variable descriptor", () => {
    const v = { name: "amount", type: "string", description: "The amount." };
    expect(TemplateVariableSchema.parse(v)).toEqual(v);
  });

  it("rejects a missing field", () => {
    expect(() =>
      TemplateVariableSchema.parse({ name: "amount", type: "string" }),
    ).toThrow();
  });
});

describe("NotificationTemplateSchema", () => {
  const valid = {
    id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
    templateKey: "transaction.completed",
    language: "en",
    channel: "whatsapp" as const,
    subject: null,
    contentText: "Hi {{name}}, your transfer is done.",
    contentHtml: null,
    whatsappTemplateId: "wa_tmpl_123",
    variables: [{ name: "name", type: "string", description: "User name." }],
  };

  it("accepts a well-formed template", () => {
    expect(NotificationTemplateSchema.parse(valid)).toEqual(valid);
  });

  it("accepts null subject/contentHtml/whatsappTemplateId", () => {
    const parsed = NotificationTemplateSchema.parse({
      ...valid,
      subject: null,
      contentHtml: null,
      whatsappTemplateId: null,
    });
    expect(parsed.subject).toBeNull();
    expect(parsed.contentHtml).toBeNull();
    expect(parsed.whatsappTemplateId).toBeNull();
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      NotificationTemplateSchema.parse({ ...valid, id: "not-a-uuid" }),
    ).toThrow();
  });

  it("rejects an invalid channel", () => {
    expect(() =>
      NotificationTemplateSchema.parse({ ...valid, channel: "web" }),
    ).toThrow();
  });
});

describe("NotificationTemplateListResponseSchema", () => {
  it("wraps an array of templates under items", () => {
    expect(NotificationTemplateListResponseSchema.parse({ items: [] })).toEqual(
      { items: [] },
    );
  });
});

describe("NotificationTemplateUpsertRequestSchema", () => {
  it("accepts a minimal upsert and defaults variables to []", () => {
    const parsed = NotificationTemplateUpsertRequestSchema.parse({
      templateKey: "kyc.approved",
      language: "en",
      channel: "email",
      contentText: "You are verified.",
    });
    expect(parsed.variables).toEqual([]);
    expect(parsed.subject).toBeUndefined();
  });

  it("rejects an empty templateKey", () => {
    expect(() =>
      NotificationTemplateUpsertRequestSchema.parse({
        templateKey: "",
        language: "en",
        channel: "email",
        contentText: "x",
      }),
    ).toThrow();
  });

  it("rejects a too-short language tag", () => {
    expect(() =>
      NotificationTemplateUpsertRequestSchema.parse({
        templateKey: "k",
        language: "e",
        channel: "email",
        contentText: "x",
      }),
    ).toThrow();
  });

  it("rejects an empty contentText", () => {
    expect(() =>
      NotificationTemplateUpsertRequestSchema.parse({
        templateKey: "k",
        language: "en",
        channel: "email",
        contentText: "",
      }),
    ).toThrow();
  });
});

describe("NotificationTemplatePreviewRequestSchema", () => {
  it("accepts a content string with a variable record", () => {
    const parsed = NotificationTemplatePreviewRequestSchema.parse({
      contentText: "Hi {{name}}",
      variables: { name: "Ada" },
    });
    expect(parsed.variables).toEqual({ name: "Ada" });
  });

  it("rejects a non-string variable value", () => {
    expect(() =>
      NotificationTemplatePreviewRequestSchema.parse({
        contentText: "Hi {{n}}",
        variables: { n: 5 },
      }),
    ).toThrow();
  });
});

describe("NotificationTemplatePreviewResponseSchema", () => {
  it("accepts a rendered text with a null subject", () => {
    const parsed = NotificationTemplatePreviewResponseSchema.parse({
      renderedSubject: null,
      renderedText: "Hi Ada",
    });
    expect(parsed.renderedSubject).toBeNull();
    expect(parsed.renderedText).toBe("Hi Ada");
  });

  it("accepts a rendered subject string", () => {
    expect(
      NotificationTemplatePreviewResponseSchema.parse({
        renderedSubject: "Welcome",
        renderedText: "Hi Ada",
      }).renderedSubject,
    ).toBe("Welcome");
  });
});

describe("DeliveryLogStatusSchema", () => {
  it("accepts the five terminal delivery states", () => {
    for (const s of [
      "delivered",
      "sent",
      "sending",
      "bounced",
      "failed",
    ] as const) {
      expect(DeliveryLogStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects an unmodelled status", () => {
    expect(() => DeliveryLogStatusSchema.parse("queued")).toThrow();
  });
});

describe("DeliveryLogEntrySchema", () => {
  const valid = {
    id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
    channel: "whatsapp" as const,
    templateKey: "kyc.approved",
    eventType: "kyc_approved",
    createdAt: "2026-07-01T09:00:00.000Z",
    status: "delivered" as const,
  };

  it("accepts a well-formed delivery-log entry", () => {
    expect(DeliveryLogEntrySchema.parse(valid)).toEqual(valid);
  });

  it("accepts a null templateKey (plain fallback message)", () => {
    expect(
      DeliveryLogEntrySchema.parse({ ...valid, templateKey: null }).templateKey,
    ).toBeNull();
  });

  it("rejects a non-ISO createdAt", () => {
    expect(() =>
      DeliveryLogEntrySchema.parse({ ...valid, createdAt: "yesterday" }),
    ).toThrow();
  });

  it("rejects an invalid channel", () => {
    expect(() =>
      DeliveryLogEntrySchema.parse({ ...valid, channel: "web" }),
    ).toThrow();
  });
});

describe("DeliveryStatsSchema", () => {
  it("accepts rates within [0,1] and a non-negative sample size", () => {
    const stats = { bounceRate: 0.004, complaintRate: 0.0002, sampleSize: 500 };
    expect(DeliveryStatsSchema.parse(stats)).toEqual(stats);
  });

  it("rejects a rate above 1", () => {
    expect(() =>
      DeliveryStatsSchema.parse({
        bounceRate: 1.2,
        complaintRate: 0,
        sampleSize: 10,
      }),
    ).toThrow();
  });

  it("rejects a non-integer sample size", () => {
    expect(() =>
      DeliveryStatsSchema.parse({
        bounceRate: 0,
        complaintRate: 0,
        sampleSize: 1.5,
      }),
    ).toThrow();
  });
});

describe("DeliveryLogResponseSchema", () => {
  it("wraps items + stats", () => {
    const parsed = DeliveryLogResponseSchema.parse({
      items: [],
      stats: { bounceRate: 0, complaintRate: 0, sampleSize: 0 },
    });
    expect(parsed.items).toEqual([]);
    expect(parsed.stats.sampleSize).toBe(0);
  });
});
