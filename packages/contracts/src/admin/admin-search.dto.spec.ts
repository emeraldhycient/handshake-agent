import {
  AdminSearchQuerySchema,
  AdminSearchResultSchema,
  AdminSearchResponseSchema,
} from "./admin-search.dto"

describe("admin search DTOs", () => {
  it("parses a query", () => {
    expect(AdminSearchQuerySchema.parse({ q: "amara" }).q).toBe("amara")
  })

  it("parses a user + transaction result set", () => {
    const parsed = AdminSearchResponseSchema.parse({
      results: [
        {
          kind: "user",
          href: "/users/u1",
          label: "Amara O.",
          sublabel: "User · tier_2",
        },
        {
          kind: "transaction",
          href: "/transactions/tx1",
          label: "buy · 10.5 USDT",
          sublabel: "Transaction · amara@example.com",
        },
      ],
    })
    expect(parsed.results).toHaveLength(2)
    expect(parsed.results[0].kind).toBe("user")
  })

  it("rejects an unknown result kind", () => {
    expect(
      AdminSearchResultSchema.safeParse({
        kind: "ticket",
        href: "/x",
        label: "x",
        sublabel: "y",
      }).success
    ).toBe(false)
  })
})
