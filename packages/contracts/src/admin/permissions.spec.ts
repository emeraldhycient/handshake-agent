import {
  PERMISSION_CATALOG,
  BUILTIN_ROLES,
  BUILTIN_ROLE_NAMES,
  permissionId,
  AdminResourceTypeSchema,
  AdminPermissionActionSchema,
} from "./permissions";

describe("permissionId", () => {
  it("derives a stable colon-joined id from a permission tuple", () => {
    expect(
      permissionId({
        resourceType: "api_route",
        resourceId: "GET /admin/admins",
        action: "read",
      }),
    ).toBe("api_route:GET /admin/admins:read");
  });
});

describe("AdminResourceTypeSchema / AdminPermissionActionSchema", () => {
  it("accepts the modelled enums and rejects others", () => {
    expect(AdminResourceTypeSchema.parse("api_route")).toBe("api_route");
    expect(AdminResourceTypeSchema.parse("web_page")).toBe("web_page");
    expect(AdminResourceTypeSchema.parse("menu_item")).toBe("menu_item");
    expect(() => AdminResourceTypeSchema.parse("other")).toThrow();
    expect(AdminPermissionActionSchema.parse("execute")).toBe("execute");
    expect(() => AdminPermissionActionSchema.parse("admin")).toThrow();
  });
});

describe("PERMISSION_CATALOG", () => {
  it("is non-empty and every entry is well-formed", () => {
    expect(PERMISSION_CATALOG.length).toBeGreaterThan(0);
    for (const e of PERMISSION_CATALOG) {
      expect(AdminResourceTypeSchema.parse(e.resourceType)).toBe(
        e.resourceType,
      );
      expect(AdminPermissionActionSchema.parse(e.action)).toBe(e.action);
      expect(e.resourceId.length).toBeGreaterThan(0);
      expect(e.category.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate permission ids", () => {
    const ids = PERMISSION_CATALOG.map(permissionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("registers the Phase-0 access + audit + treasury routes", () => {
    const ids = new Set(PERMISSION_CATALOG.map(permissionId));
    expect(ids.has("api_route:GET /admin/admins:read")).toBe(true);
    expect(ids.has("api_route:POST /admin/roles:write")).toBe(true);
    expect(ids.has("api_route:GET /admin/audit:read")).toBe(true);
    expect(ids.has("api_route:POST /admin/wallets/reconcile:execute")).toBe(
      true,
    );
  });

  it("includes menu_item and web_page resources for nav gating", () => {
    const types = new Set(PERMISSION_CATALOG.map((e) => e.resourceType));
    expect(types.has("menu_item")).toBe(true);
    expect(types.has("web_page")).toBe(true);
  });

  it("registers the Config settings routes + nav (Phase 1)", () => {
    const ids = new Set(PERMISSION_CATALOG.map(permissionId));
    expect(ids.has("api_route:GET /admin/settings:read")).toBe(true);
    expect(ids.has("api_route:GET /admin/settings/:key:read")).toBe(true);
    expect(ids.has("api_route:PATCH /admin/settings/:key:write")).toBe(true);
    expect(ids.has("web_page:/admin/settings:read")).toBe(true);
    expect(ids.has("menu_item:menu.config:read")).toBe(true);
    for (const e of PERMISSION_CATALOG.filter((x) => x.category === "Config")) {
      expect(e.category).toBe("Config");
    }
  });

  it("registers the Users management routes + nav (Phase 2)", () => {
    const ids = new Set(PERMISSION_CATALOG.map(permissionId));
    expect(ids.has("api_route:GET /admin/users:read")).toBe(true);
    expect(ids.has("api_route:GET /admin/users/:id:read")).toBe(true);
    expect(ids.has("api_route:PATCH /admin/users/:id/tier:write")).toBe(true);
    expect(ids.has("api_route:PATCH /admin/users/:id/status:write")).toBe(true);
    expect(ids.has("api_route:POST /admin/users/:id/pin-reset:write")).toBe(
      true,
    );
    expect(ids.has("api_route:GET /admin/users/:id/devices:read")).toBe(true);
    expect(
      ids.has("api_route:DELETE /admin/users/:id/devices/:deviceId:write"),
    ).toBe(true);
    expect(
      ids.has("api_route:POST /admin/users/:id/sim-swap-reverify:write"),
    ).toBe(true);
    expect(ids.has("web_page:/admin/users:read")).toBe(true);
    expect(ids.has("menu_item:menu.users:read")).toBe(true);
    for (const e of PERMISSION_CATALOG.filter((x) => x.category === "Users")) {
      expect(e.category).toBe("Users");
    }
  });

  it("registers the KYC review routes + nav (Phase 2)", () => {
    const ids = new Set(PERMISSION_CATALOG.map(permissionId));
    expect(ids.has("api_route:GET /admin/kyc/queue:read")).toBe(true);
    expect(ids.has("api_route:GET /admin/kyc/:userId:read")).toBe(true);
    expect(ids.has("api_route:POST /admin/kyc/:userId/approve:write")).toBe(
      true,
    );
    expect(ids.has("api_route:POST /admin/kyc/:userId/reject:write")).toBe(
      true,
    );
    expect(ids.has("web_page:/admin/kyc:read")).toBe(true);
    expect(ids.has("menu_item:menu.kyc:read")).toBe(true);
    for (const e of PERMISSION_CATALOG.filter((x) => x.category === "KYC")) {
      expect(e.category).toBe("KYC");
    }
  });

  it("registers the Transactions oversight routes + nav (Phase 3)", () => {
    const ids = new Set(PERMISSION_CATALOG.map(permissionId));
    expect(ids.has("api_route:GET /admin/transactions:read")).toBe(true);
    expect(ids.has("api_route:GET /admin/transactions/:id:read")).toBe(true);
    expect(ids.has("web_page:/admin/transactions:read")).toBe(true);
    expect(ids.has("menu_item:menu.transactions:read")).toBe(true);
    for (const e of PERMISSION_CATALOG.filter(
      (x) => x.category === "Transactions",
    )) {
      expect(e.category).toBe("Transactions");
    }
  });

  it("registers the Transactions triage routes (Phase 3 sub-area B)", () => {
    const ids = new Set(PERMISSION_CATALOG.map(permissionId));
    expect(
      ids.has("api_route:POST /admin/transactions/:id/mark-failed:execute"),
    ).toBe(true);
    expect(
      ids.has("api_route:POST /admin/transactions/:id/retry:execute"),
    ).toBe(true);
    for (const e of PERMISSION_CATALOG.filter(
      (x) =>
        x.resourceType === "api_route" &&
        (x.resourceId === "POST /admin/transactions/:id/mark-failed" ||
          x.resourceId === "POST /admin/transactions/:id/retry"),
    )) {
      expect(e.category).toBe("Transactions");
      expect(e.action).toBe("execute");
    }
  });

  it("registers the Ledger oversight routes + nav (Phase 3)", () => {
    const ids = new Set(PERMISSION_CATALOG.map(permissionId));
    expect(ids.has("api_route:GET /admin/ledger:read")).toBe(true);
    expect(
      ids.has("api_route:POST /admin/ledger/verify/:transactionId:execute"),
    ).toBe(true);
    expect(ids.has("web_page:/admin/ledger:read")).toBe(true);
    expect(ids.has("menu_item:menu.ledger:read")).toBe(true);
    for (const e of PERMISSION_CATALOG.filter((x) => x.category === "Ledger")) {
      expect(e.category).toBe("Ledger");
    }
  });

  it("registers the Compliance console routes + nav (Phase 3 sub-area C)", () => {
    const ids = new Set(PERMISSION_CATALOG.map(permissionId));
    expect(ids.has("api_route:GET /admin/compliance/events:read")).toBe(true);
    expect(ids.has("api_route:GET /admin/compliance/events/:id:read")).toBe(
      true,
    );
    expect(
      ids.has("api_route:POST /admin/compliance/events/:id/disposition:write"),
    ).toBe(true);
    expect(ids.has("api_route:GET /admin/compliance/sanctions:read")).toBe(
      true,
    );
    expect(ids.has("api_route:GET /admin/compliance/monitoring:read")).toBe(
      true,
    );
    expect(ids.has("api_route:GET /admin/compliance/aml-rules:read")).toBe(
      true,
    );
    expect(ids.has("api_route:POST /admin/compliance/aml-rules:write")).toBe(
      true,
    );
    expect(
      ids.has("api_route:PATCH /admin/compliance/aml-rules/:id:write"),
    ).toBe(true);
    expect(ids.has("api_route:GET /admin/compliance/travel-rule:read")).toBe(
      true,
    );
    expect(ids.has("api_route:GET /admin/compliance/reports:read")).toBe(true);
    expect(ids.has("api_route:POST /admin/compliance/reports:write")).toBe(
      true,
    );
    expect(
      ids.has("api_route:POST /admin/compliance/reports/:id/submit:execute"),
    ).toBe(true);
    expect(ids.has("web_page:/admin/compliance:read")).toBe(true);
    expect(ids.has("menu_item:menu.compliance:read")).toBe(true);
    for (const e of PERMISSION_CATALOG.filter(
      (x) => x.category === "Compliance",
    )) {
      expect(e.category).toBe("Compliance");
    }
  });

  it("registers the Treasury oversight routes + nav (Phase 3 sub-area D)", () => {
    const ids = new Set(PERMISSION_CATALOG.map(permissionId));
    expect(ids.has("api_route:GET /admin/treasury/balances:read")).toBe(true);
    expect(ids.has("api_route:GET /admin/treasury/exposure:read")).toBe(true);
    expect(ids.has("api_route:GET /admin/treasury/alerts:read")).toBe(true);
    expect(
      ids.has("api_route:POST /admin/treasury/alerts/:id/acknowledge:write"),
    ).toBe(true);
    expect(
      ids.has("api_route:GET /admin/treasury/withdrawal-policies:read"),
    ).toBe(true);
    // The legacy folded treasury wallet-ops nav already exists; assert it stands.
    expect(ids.has("web_page:/admin/treasury:read")).toBe(true);
    expect(ids.has("menu_item:menu.treasury:read")).toBe(true);
    for (const e of PERMISSION_CATALOG.filter(
      (x) => x.category === "Treasury",
    )) {
      expect(e.category).toBe("Treasury");
    }
  });

  it("registers the Comms notification-template + WhatsApp routes + nav (Phase 4 wave 1)", () => {
    const ids = new Set(PERMISSION_CATALOG.map(permissionId));
    expect(ids.has("api_route:GET /admin/notification-templates:read")).toBe(
      true,
    );
    expect(
      ids.has(
        "api_route:GET /admin/notification-templates/:templateKey/:language/:channel:read",
      ),
    ).toBe(true);
    expect(ids.has("api_route:POST /admin/notification-templates:write")).toBe(
      true,
    );
    expect(
      ids.has(
        "api_route:PATCH /admin/notification-templates/:templateKey/:language/:channel:write",
      ),
    ).toBe(true);
    expect(
      ids.has("api_route:POST /admin/notification-templates/preview:read"),
    ).toBe(true);
    expect(ids.has("api_route:GET /admin/whatsapp/config:read")).toBe(true);
    expect(ids.has("web_page:/admin/notifications:read")).toBe(true);
    expect(ids.has("web_page:/admin/whatsapp:read")).toBe(true);
    expect(ids.has("menu_item:menu.notifications:read")).toBe(true);
    expect(ids.has("menu_item:menu.whatsapp:read")).toBe(true);
    for (const e of PERMISSION_CATALOG.filter((x) => x.category === "Comms")) {
      expect(e.category).toBe("Comms");
    }
  });

  it("registers the Tickets oversight route + nav (Phase 4 wave 2)", () => {
    const ids = new Set(PERMISSION_CATALOG.map(permissionId));
    expect(ids.has("api_route:GET /admin/tickets/orders:read")).toBe(true);
    expect(ids.has("web_page:/admin/tickets:read")).toBe(true);
    expect(ids.has("menu_item:menu.tickets:read")).toBe(true);
    for (const e of PERMISSION_CATALOG.filter(
      (x) => x.category === "Tickets",
    )) {
      expect(e.category).toBe("Tickets");
    }
  });

  it("registers the Agent config + conversation-log routes + nav (Phase 4 wave 2)", () => {
    const ids = new Set(PERMISSION_CATALOG.map(permissionId));
    expect(ids.has("api_route:GET /admin/agent/config:read")).toBe(true);
    expect(ids.has("api_route:GET /admin/agent/conversations:read")).toBe(true);
    expect(ids.has("api_route:GET /admin/agent/conversations/:id:read")).toBe(
      true,
    );
    expect(ids.has("web_page:/admin/agent:read")).toBe(true);
    expect(ids.has("menu_item:menu.agent:read")).toBe(true);
    for (const e of PERMISSION_CATALOG.filter((x) => x.category === "Agent")) {
      expect(e.category).toBe("Agent");
      // Agent surfaces are read-only — no write/execute/delete (§3.1/§6).
      expect(e.action).toBe("read");
    }
  });

  it("registers the Metrics dashboard routes + nav (Phase 5)", () => {
    const ids = new Set(PERMISSION_CATALOG.map(permissionId));
    expect(ids.has("api_route:GET /admin/metrics/dashboard:read")).toBe(true);
    expect(ids.has("api_route:GET /admin/metrics/transactions:read")).toBe(
      true,
    );
    expect(ids.has("api_route:GET /admin/metrics/revenue:read")).toBe(true);
    expect(ids.has("api_route:GET /admin/metrics/kyc-funnel:read")).toBe(true);
    expect(ids.has("web_page:/admin/metrics:read")).toBe(true);
    expect(ids.has("menu_item:menu.metrics:read")).toBe(true);
    for (const e of PERMISSION_CATALOG.filter(
      (x) => x.category === "Metrics",
    )) {
      expect(e.category).toBe("Metrics");
      // Metrics surfaces are read-only — no write/execute/delete (§3.1).
      expect(e.action).toBe("read");
    }
  });

  it("registers the Beneficiaries oversight routes + nav (Phase 3 sub-area D)", () => {
    const ids = new Set(PERMISSION_CATALOG.map(permissionId));
    expect(ids.has("api_route:GET /admin/beneficiaries:read")).toBe(true);
    expect(
      ids.has(
        "api_route:POST /admin/beneficiaries/:id/cooling-off-override:write",
      ),
    ).toBe(true);
    expect(ids.has("web_page:/admin/beneficiaries:read")).toBe(true);
    expect(ids.has("menu_item:menu.beneficiaries:read")).toBe(true);
    for (const e of PERMISSION_CATALOG.filter(
      (x) => x.category === "Beneficiaries",
    )) {
      expect(e.category).toBe("Beneficiaries");
    }
  });
});

describe("BUILTIN_ROLES", () => {
  it("matches the canonical role-name list", () => {
    expect(BUILTIN_ROLES.map((r) => r.name)).toEqual([...BUILTIN_ROLE_NAMES]);
  });

  it("marks every built-in role isBuiltin and gives a description", () => {
    for (const r of BUILTIN_ROLES) {
      expect(r.isBuiltin).toBe(true);
      expect(r.description.length).toBeGreaterThan(0);
    }
  });

  it("super_admin grants every catalog entry", () => {
    const sa = BUILTIN_ROLES.find((r) => r.name === "super_admin")!;
    for (const e of PERMISSION_CATALOG) {
      expect(sa.grants(e)).toBe(true);
    }
  });

  it("non-super roles are a strict subset of the catalog (default-deny)", () => {
    for (const r of BUILTIN_ROLES.filter((x) => x.name !== "super_admin")) {
      const granted = PERMISSION_CATALOG.filter((e) => r.grants(e));
      expect(granted.length).toBeLessThan(PERMISSION_CATALOG.length);
    }
  });

  it("finance may execute treasury reconcile but may NOT manage admins", () => {
    const finance = BUILTIN_ROLES.find((r) => r.name === "finance")!;
    const reconcile = PERMISSION_CATALOG.find(
      (e) =>
        permissionId(e) === "api_route:POST /admin/wallets/reconcile:execute",
    )!;
    const writeAdmins = PERMISSION_CATALOG.find(
      (e) => permissionId(e) === "api_route:PATCH /admin/admins/:id/role:write",
    )!;
    expect(finance.grants(reconcile)).toBe(true);
    expect(finance.grants(writeAdmins)).toBe(false);
  });

  it("grants Config read+write to finance, read-only to ops, none to support", () => {
    const settingsRead = PERMISSION_CATALOG.find(
      (e) => permissionId(e) === "api_route:GET /admin/settings:read",
    )!;
    const settingsWrite = PERMISSION_CATALOG.find(
      (e) => permissionId(e) === "api_route:PATCH /admin/settings/:key:write",
    )!;
    const finance = BUILTIN_ROLES.find((r) => r.name === "finance")!;
    const ops = BUILTIN_ROLES.find((r) => r.name === "ops")!;
    const support = BUILTIN_ROLES.find((r) => r.name === "support")!;

    expect(finance.grants(settingsRead)).toBe(true);
    expect(finance.grants(settingsWrite)).toBe(true);
    expect(ops.grants(settingsRead)).toBe(true);
    expect(ops.grants(settingsWrite)).toBe(false);
    expect(support.grants(settingsRead)).toBe(false);
  });

  it("only super_admin can manage roles", () => {
    const createRole = PERMISSION_CATALOG.find(
      (e) => permissionId(e) === "api_route:POST /admin/roles:write",
    )!;
    for (const r of BUILTIN_ROLES) {
      expect(r.grants(createRole)).toBe(r.name === "super_admin");
    }
  });

  it("grants Users read+write to compliance and ops, read-only to support (Phase 2)", () => {
    const usersRead = PERMISSION_CATALOG.find(
      (e) => permissionId(e) === "api_route:GET /admin/users:read",
    )!;
    const usersWrite = PERMISSION_CATALOG.find(
      (e) =>
        permissionId(e) === "api_route:PATCH /admin/users/:id/status:write",
    )!;
    const compliance = BUILTIN_ROLES.find((r) => r.name === "compliance")!;
    const ops = BUILTIN_ROLES.find((r) => r.name === "ops")!;
    const support = BUILTIN_ROLES.find((r) => r.name === "support")!;
    const finance = BUILTIN_ROLES.find((r) => r.name === "finance")!;

    expect(compliance.grants(usersRead)).toBe(true);
    expect(compliance.grants(usersWrite)).toBe(true);
    expect(ops.grants(usersRead)).toBe(true);
    expect(ops.grants(usersWrite)).toBe(true);
    expect(support.grants(usersRead)).toBe(true);
    expect(support.grants(usersWrite)).toBe(false);
    expect(finance.grants(usersRead)).toBe(false);
  });

  it("grants KYC read+write to compliance, read-only to support, none to ops (Phase 2)", () => {
    const kycRead = PERMISSION_CATALOG.find(
      (e) => permissionId(e) === "api_route:GET /admin/kyc/queue:read",
    )!;
    const kycWrite = PERMISSION_CATALOG.find(
      (e) =>
        permissionId(e) === "api_route:POST /admin/kyc/:userId/approve:write",
    )!;
    const compliance = BUILTIN_ROLES.find((r) => r.name === "compliance")!;
    const support = BUILTIN_ROLES.find((r) => r.name === "support")!;
    const ops = BUILTIN_ROLES.find((r) => r.name === "ops")!;

    expect(compliance.grants(kycRead)).toBe(true);
    expect(compliance.grants(kycWrite)).toBe(true);
    expect(support.grants(kycRead)).toBe(true);
    expect(support.grants(kycWrite)).toBe(false);
    expect(ops.grants(kycRead)).toBe(false);
    expect(ops.grants(kycWrite)).toBe(false);
  });

  it("grants Transactions read to ops, compliance and finance; none to support (Phase 3)", () => {
    const txnRead = PERMISSION_CATALOG.find(
      (e) => permissionId(e) === "api_route:GET /admin/transactions:read",
    )!;
    const ops = BUILTIN_ROLES.find((r) => r.name === "ops")!;
    const compliance = BUILTIN_ROLES.find((r) => r.name === "compliance")!;
    const finance = BUILTIN_ROLES.find((r) => r.name === "finance")!;
    const support = BUILTIN_ROLES.find((r) => r.name === "support")!;

    expect(ops.grants(txnRead)).toBe(true);
    expect(compliance.grants(txnRead)).toBe(true);
    expect(finance.grants(txnRead)).toBe(true);
    expect(support.grants(txnRead)).toBe(false);
  });

  it("grants Transactions EXECUTE (triage) to finance + super_admin only (Phase 3B)", () => {
    const txnMarkFailed = PERMISSION_CATALOG.find(
      (e) =>
        permissionId(e) ===
        "api_route:POST /admin/transactions/:id/mark-failed:execute",
    )!;
    const txnRetry = PERMISSION_CATALOG.find(
      (e) =>
        permissionId(e) ===
        "api_route:POST /admin/transactions/:id/retry:execute",
    )!;
    const superAdmin = BUILTIN_ROLES.find((r) => r.name === "super_admin")!;
    const finance = BUILTIN_ROLES.find((r) => r.name === "finance")!;
    const ops = BUILTIN_ROLES.find((r) => r.name === "ops")!;
    const compliance = BUILTIN_ROLES.find((r) => r.name === "compliance")!;
    const support = BUILTIN_ROLES.find((r) => r.name === "support")!;

    for (const perm of [txnMarkFailed, txnRetry]) {
      expect(superAdmin.grants(perm)).toBe(true);
      expect(finance.grants(perm)).toBe(true);
      // ops/compliance hold Transactions:read only — not execute (default-deny).
      expect(ops.grants(perm)).toBe(false);
      expect(compliance.grants(perm)).toBe(false);
      expect(support.grants(perm)).toBe(false);
    }
  });

  it("grants Ledger read+execute to finance only; not to ops/compliance/support (Phase 3)", () => {
    const ledgerRead = PERMISSION_CATALOG.find(
      (e) => permissionId(e) === "api_route:GET /admin/ledger:read",
    )!;
    const ledgerVerify = PERMISSION_CATALOG.find(
      (e) =>
        permissionId(e) ===
        "api_route:POST /admin/ledger/verify/:transactionId:execute",
    )!;
    const finance = BUILTIN_ROLES.find((r) => r.name === "finance")!;
    const ops = BUILTIN_ROLES.find((r) => r.name === "ops")!;
    const compliance = BUILTIN_ROLES.find((r) => r.name === "compliance")!;
    const support = BUILTIN_ROLES.find((r) => r.name === "support")!;

    expect(finance.grants(ledgerRead)).toBe(true);
    expect(finance.grants(ledgerVerify)).toBe(true);
    expect(ops.grants(ledgerRead)).toBe(false);
    expect(ops.grants(ledgerVerify)).toBe(false);
    expect(compliance.grants(ledgerRead)).toBe(false);
    expect(support.grants(ledgerRead)).toBe(false);
  });

  it("grants Treasury read+write to finance + ops; not to compliance/support (Phase 3D)", () => {
    const balancesRead = PERMISSION_CATALOG.find(
      (e) => permissionId(e) === "api_route:GET /admin/treasury/balances:read",
    )!;
    const ackWrite = PERMISSION_CATALOG.find(
      (e) =>
        permissionId(e) ===
        "api_route:POST /admin/treasury/alerts/:id/acknowledge:write",
    )!;
    const finance = BUILTIN_ROLES.find((r) => r.name === "finance")!;
    const ops = BUILTIN_ROLES.find((r) => r.name === "ops")!;
    const compliance = BUILTIN_ROLES.find((r) => r.name === "compliance")!;
    const support = BUILTIN_ROLES.find((r) => r.name === "support")!;

    expect(finance.grants(balancesRead)).toBe(true);
    expect(finance.grants(ackWrite)).toBe(true);
    expect(ops.grants(balancesRead)).toBe(true);
    expect(ops.grants(ackWrite)).toBe(true);
    expect(compliance.grants(balancesRead)).toBe(false);
    expect(support.grants(balancesRead)).toBe(false);
  });

  it("grants Beneficiaries read+write to compliance + ops, read-only to support, none to finance (Phase 3D)", () => {
    const benRead = PERMISSION_CATALOG.find(
      (e) => permissionId(e) === "api_route:GET /admin/beneficiaries:read",
    )!;
    const overrideWrite = PERMISSION_CATALOG.find(
      (e) =>
        permissionId(e) ===
        "api_route:POST /admin/beneficiaries/:id/cooling-off-override:write",
    )!;
    const compliance = BUILTIN_ROLES.find((r) => r.name === "compliance")!;
    const ops = BUILTIN_ROLES.find((r) => r.name === "ops")!;
    const support = BUILTIN_ROLES.find((r) => r.name === "support")!;
    const finance = BUILTIN_ROLES.find((r) => r.name === "finance")!;

    expect(compliance.grants(benRead)).toBe(true);
    expect(compliance.grants(overrideWrite)).toBe(true);
    expect(ops.grants(benRead)).toBe(true);
    expect(ops.grants(overrideWrite)).toBe(true);
    expect(support.grants(benRead)).toBe(true);
    expect(support.grants(overrideWrite)).toBe(false);
    expect(finance.grants(benRead)).toBe(false);
  });

  it("grants Comms read+write to ops, read-only to support, none to finance (Phase 4 wave 1)", () => {
    const tmplRead = PERMISSION_CATALOG.find(
      (e) =>
        permissionId(e) === "api_route:GET /admin/notification-templates:read",
    )!;
    const tmplWrite = PERMISSION_CATALOG.find(
      (e) =>
        permissionId(e) ===
        "api_route:POST /admin/notification-templates:write",
    )!;
    const ops = BUILTIN_ROLES.find((r) => r.name === "ops")!;
    const support = BUILTIN_ROLES.find((r) => r.name === "support")!;
    const finance = BUILTIN_ROLES.find((r) => r.name === "finance")!;
    const superAdmin = BUILTIN_ROLES.find((r) => r.name === "super_admin")!;

    expect(ops.grants(tmplRead)).toBe(true);
    expect(ops.grants(tmplWrite)).toBe(true);
    expect(support.grants(tmplRead)).toBe(true);
    expect(support.grants(tmplWrite)).toBe(false);
    expect(finance.grants(tmplRead)).toBe(false);
    expect(superAdmin.grants(tmplWrite)).toBe(true);
  });

  it("grants Tickets read to ops only; none to support/finance/compliance (Phase 4 wave 2)", () => {
    const ticketsRead = PERMISSION_CATALOG.find(
      (e) => permissionId(e) === "api_route:GET /admin/tickets/orders:read",
    )!;
    const ops = BUILTIN_ROLES.find((r) => r.name === "ops")!;
    const support = BUILTIN_ROLES.find((r) => r.name === "support")!;
    const finance = BUILTIN_ROLES.find((r) => r.name === "finance")!;
    const compliance = BUILTIN_ROLES.find((r) => r.name === "compliance")!;

    expect(ops.grants(ticketsRead)).toBe(true);
    expect(support.grants(ticketsRead)).toBe(false);
    expect(finance.grants(ticketsRead)).toBe(false);
    expect(compliance.grants(ticketsRead)).toBe(false);
  });

  it("grants Agent read to ops + support; none to finance/compliance (Phase 4 wave 2)", () => {
    const agentConfig = PERMISSION_CATALOG.find(
      (e) => permissionId(e) === "api_route:GET /admin/agent/config:read",
    )!;
    const ops = BUILTIN_ROLES.find((r) => r.name === "ops")!;
    const support = BUILTIN_ROLES.find((r) => r.name === "support")!;
    const finance = BUILTIN_ROLES.find((r) => r.name === "finance")!;
    const compliance = BUILTIN_ROLES.find((r) => r.name === "compliance")!;

    expect(ops.grants(agentConfig)).toBe(true);
    expect(support.grants(agentConfig)).toBe(true);
    expect(finance.grants(agentConfig)).toBe(false);
    expect(compliance.grants(agentConfig)).toBe(false);
  });

  it("grants Metrics read to ALL non-super built-in roles (Phase 5)", () => {
    const dashboard = PERMISSION_CATALOG.find(
      (e) => permissionId(e) === "api_route:GET /admin/metrics/dashboard:read",
    )!;
    for (const r of BUILTIN_ROLES.filter((x) => x.name !== "super_admin")) {
      expect(r.grants(dashboard)).toBe(true);
    }
    // super_admin holds everything by definition.
    const superAdmin = BUILTIN_ROLES.find((r) => r.name === "super_admin")!;
    expect(superAdmin.grants(dashboard)).toBe(true);
  });

  it("grants Compliance read+write+execute to compliance, read-only to ops, none to finance/support (Phase 3C)", () => {
    const eventsRead = PERMISSION_CATALOG.find(
      (e) => permissionId(e) === "api_route:GET /admin/compliance/events:read",
    )!;
    const disposition = PERMISSION_CATALOG.find(
      (e) =>
        permissionId(e) ===
        "api_route:POST /admin/compliance/events/:id/disposition:write",
    )!;
    const submitReport = PERMISSION_CATALOG.find(
      (e) =>
        permissionId(e) ===
        "api_route:POST /admin/compliance/reports/:id/submit:execute",
    )!;
    const compliance = BUILTIN_ROLES.find((r) => r.name === "compliance")!;
    const ops = BUILTIN_ROLES.find((r) => r.name === "ops")!;
    const finance = BUILTIN_ROLES.find((r) => r.name === "finance")!;
    const support = BUILTIN_ROLES.find((r) => r.name === "support")!;

    // compliance: full read + write + execute.
    expect(compliance.grants(eventsRead)).toBe(true);
    expect(compliance.grants(disposition)).toBe(true);
    expect(compliance.grants(submitReport)).toBe(true);
    // ops: read-only.
    expect(ops.grants(eventsRead)).toBe(true);
    expect(ops.grants(disposition)).toBe(false);
    expect(ops.grants(submitReport)).toBe(false);
    // finance/support: no compliance access.
    expect(finance.grants(eventsRead)).toBe(false);
    expect(support.grants(eventsRead)).toBe(false);
  });
});
