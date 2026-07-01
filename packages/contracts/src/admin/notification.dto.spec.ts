import {
  NotificationChannelSchema,
  TemplateVariableSchema,
  NotificationTemplateSchema,
  NotificationTemplateListResponseSchema,
  NotificationTemplateUpsertRequestSchema,
  NotificationTemplatePreviewRequestSchema,
  NotificationTemplatePreviewResponseSchema,
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
    expect(
      NotificationTemplateListResponseSchema.parse({ items: [] }),
    ).toEqual({ items: [] });
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
