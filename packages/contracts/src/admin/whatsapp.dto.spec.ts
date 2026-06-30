import { WhatsAppConfigViewSchema } from "./whatsapp.dto";

describe("WhatsAppConfigViewSchema", () => {
  const valid = {
    graphVersion: "v25.0",
    graphBaseUrl: "https://graph.facebook.com",
    phoneNumberId: "123456789",
    flowId: "flow_1",
    beneficiaryFlowId: "flow_2",
    wabaId: "waba_1",
    appId: "app_1",
    hasAppSecret: true,
    hasFlowPrivateKey: false,
    hasVerifyToken: true,
  };

  it("accepts a well-formed non-secret config view", () => {
    expect(WhatsAppConfigViewSchema.parse(valid)).toEqual(valid);
  });

  it("requires the has* fields to be booleans", () => {
    expect(() =>
      WhatsAppConfigViewSchema.parse({ ...valid, hasAppSecret: "yes" }),
    ).toThrow();
  });

  it("rejects a missing field", () => {
    const { phoneNumberId: _omit, ...rest } = valid;
    expect(() => WhatsAppConfigViewSchema.parse(rest)).toThrow();
  });
});
