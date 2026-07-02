import {
  AdminPreferencesSchema,
  AdminPreferencesUpdateRequestSchema,
} from "./preferences.dto";

const prefs = {
  emailAlerts: true,
  approvalMentions: false,
  weeklyDigest: true,
};

describe("AdminPreferencesSchema", () => {
  it("parses the three notification-preference booleans", () => {
    const parsed = AdminPreferencesSchema.parse(prefs);
    expect(parsed).toEqual(prefs);
  });

  it("rejects a non-boolean flag", () => {
    expect(() =>
      AdminPreferencesSchema.parse({ ...prefs, emailAlerts: "yes" }),
    ).toThrow();
  });

  it("rejects a missing flag (full-state shape)", () => {
    const { weeklyDigest: _omit, ...partial } = prefs;
    expect(() => AdminPreferencesSchema.parse(partial)).toThrow();
  });
});

describe("AdminPreferencesUpdateRequestSchema", () => {
  it("parses a full-state replace of all three booleans", () => {
    const parsed = AdminPreferencesUpdateRequestSchema.parse({
      emailAlerts: false,
      approvalMentions: true,
      weeklyDigest: false,
    });
    expect(parsed.emailAlerts).toBe(false);
    expect(parsed.approvalMentions).toBe(true);
    expect(parsed.weeklyDigest).toBe(false);
  });

  it("rejects a partial update (the toggle UI sends the full state)", () => {
    expect(() =>
      AdminPreferencesUpdateRequestSchema.parse({ emailAlerts: true }),
    ).toThrow();
  });
});
