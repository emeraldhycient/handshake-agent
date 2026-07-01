import {
  TicketOrderItemSchema,
  TicketOrderListResponseSchema,
} from "./ticket.dto";

const validItem = {
  id: "11111111-1111-1111-1111-111111111111",
  userId: "22222222-2222-2222-2222-222222222222",
  vendorKey: "zentry",
  ticketType: "VIP",
  quantity: 2,
  totalAmount: "10000.00",
  paymentStatus: "pending",
  settlementStatus: "pending",
  deliveryStatus: "pending",
  createdAt: "2026-06-30T00:00:00.000Z",
};

describe("TicketOrderItemSchema", () => {
  it("parses a well-formed ticket order item", () => {
    expect(TicketOrderItemSchema.parse(validItem)).toEqual(validItem);
  });

  it("requires id and userId to be uuids", () => {
    expect(() =>
      TicketOrderItemSchema.parse({ ...validItem, id: "not-a-uuid" }),
    ).toThrow();
    expect(() =>
      TicketOrderItemSchema.parse({ ...validItem, userId: "nope" }),
    ).toThrow();
  });

  it("keeps totalAmount a string (engine-precision, never a float)", () => {
    expect(() =>
      TicketOrderItemSchema.parse({ ...validItem, totalAmount: 10000 }),
    ).toThrow();
  });

  it("requires quantity to be a number", () => {
    expect(() =>
      TicketOrderItemSchema.parse({ ...validItem, quantity: "2" }),
    ).toThrow();
  });
});

describe("TicketOrderListResponseSchema", () => {
  it("parses an empty list with a null cursor", () => {
    expect(
      TicketOrderListResponseSchema.parse({ items: [], nextCursor: null }),
    ).toEqual({ items: [], nextCursor: null });
  });

  it("parses a populated list with a cursor", () => {
    const parsed = TicketOrderListResponseSchema.parse({
      items: [validItem],
      nextCursor: validItem.id,
    });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.nextCursor).toBe(validItem.id);
  });

  it("rejects a missing nextCursor field", () => {
    expect(() =>
      TicketOrderListResponseSchema.parse({ items: [] }),
    ).toThrow();
  });
});
