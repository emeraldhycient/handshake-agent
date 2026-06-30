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
    expect(ids.has("api_route:POST /admin/kyc/:userId/reject:write")).toBe(true);
    expect(ids.has("web_page:/admin/kyc:read")).toBe(true);
    expect(ids.has("menu_item:menu.kyc:read")).toBe(true);
    for (const e of PERMISSION_CATALOG.filter((x) => x.category === "KYC")) {
      expect(e.category).toBe("KYC");
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
      (e) => permissionId(e) === "api_route:PATCH /admin/users/:id/status:write",
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
      (e) => permissionId(e) === "api_route:POST /admin/kyc/:userId/approve:write",
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
});
