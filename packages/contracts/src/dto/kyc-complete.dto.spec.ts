import {
  SetPinRequestSchema,
  TransactionPinSchema,
} from "./kyc-complete.dto";

describe("TransactionPinSchema", () => {
  it("accepts a 4-digit numeric PIN", () => {
    expect(TransactionPinSchema.parse("1357")).toBe("1357");
  });

  it("accepts a 6-digit numeric PIN", () => {
    expect(TransactionPinSchema.parse("135790")).toBe("135790");
  });

  it("rejects a 1-digit PIN", () => {
    expect(() => TransactionPinSchema.parse("1")).toThrow();
  });

  it("rejects a 3-digit PIN (below the floor)", () => {
    expect(() => TransactionPinSchema.parse("135")).toThrow();
  });

  it("rejects a 7-digit PIN (above the ceiling)", () => {
    expect(() => TransactionPinSchema.parse("1357913")).toThrow();
  });

  it("rejects a non-numeric PIN", () => {
    expect(() => TransactionPinSchema.parse("12a4")).toThrow();
    expect(() => TransactionPinSchema.parse("abcd")).toThrow();
  });

  it("rejects an all-same-digit PIN (0000, 1111)", () => {
    expect(() => TransactionPinSchema.parse("0000")).toThrow();
    expect(() => TransactionPinSchema.parse("1111")).toThrow();
    expect(() => TransactionPinSchema.parse("999999")).toThrow();
  });

  it("rejects a trivial ascending sequence (1234, 123456)", () => {
    expect(() => TransactionPinSchema.parse("1234")).toThrow();
    expect(() => TransactionPinSchema.parse("123456")).toThrow();
  });

  it("rejects a trivial descending sequence (4321, 654321)", () => {
    expect(() => TransactionPinSchema.parse("4321")).toThrow();
    expect(() => TransactionPinSchema.parse("654321")).toThrow();
  });

  it("rejects the empty string", () => {
    expect(() => TransactionPinSchema.parse("")).toThrow();
  });
});

describe("SetPinRequestSchema", () => {
  it("accepts a strong PIN with no identity fields", () => {
    const parsed = SetPinRequestSchema.parse({ pin: "1357" });
    expect(parsed.pin).toBe("1357");
  });

  it("rejects a weak PIN", () => {
    expect(() => SetPinRequestSchema.parse({ pin: "1" })).toThrow();
    expect(() => SetPinRequestSchema.parse({ pin: "1111" })).toThrow();
    expect(() => SetPinRequestSchema.parse({ pin: "1234" })).toThrow();
  });

  it("rejects a missing PIN", () => {
    expect(() => SetPinRequestSchema.parse({})).toThrow();
  });
});
