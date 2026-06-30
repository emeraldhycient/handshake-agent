import {
  AdminPermissionRecordSchema,
  RoleSchema,
  RoleCreateRequestSchema,
  RoleUpdateRequestSchema,
  RoleListResponseSchema,
  PermissionListResponseSchema,
} from "./rbac.dto";

const ID = "11111111-1111-1111-1111-111111111111";

const permissionRecord = {
  id: ID,
  resourceType: "api_route" as const,
  resourceId: "GET /admin/admins",
  action: "read" as const,
  category: "Access",
  description: "List admin users",
};

const role = {
  id: ID,
  name: "ops",
  description: "Operations role",
  isBuiltin: true,
  permissionIds: ["api_route:GET /admin/audit:read"],
};

describe("AdminPermissionRecordSchema", () => {
  it("parses a permission record", () => {
    const parsed = AdminPermissionRecordSchema.parse(permissionRecord);
    expect(parsed.resourceType).toBe("api_route");
  });

  it("rejects an unknown resourceType", () => {
    expect(() =>
      AdminPermissionRecordSchema.parse({
        ...permissionRecord,
        resourceType: "database_table",
      }),
    ).toThrow();
  });
});

describe("RoleSchema", () => {
  it("parses a role", () => {
    const parsed = RoleSchema.parse(role);
    expect(parsed.permissionIds).toHaveLength(1);
  });

  it("rejects a role missing isBuiltin", () => {
    const { isBuiltin: _omit, ...withoutBuiltin } = role;
    expect(() => RoleSchema.parse(withoutBuiltin)).toThrow();
  });
});

describe("RoleCreateRequestSchema", () => {
  it("parses a create-role request", () => {
    const parsed = RoleCreateRequestSchema.parse({
      name: "auditor",
      description: "Read-only auditor",
      permissionIds: ["api_route:GET /admin/audit:read"],
    });
    expect(parsed.name).toBe("auditor");
  });

  it("rejects an empty name", () => {
    expect(() =>
      RoleCreateRequestSchema.parse({
        name: "",
        description: "Read-only auditor",
        permissionIds: [],
      }),
    ).toThrow();
  });
});

describe("RoleUpdateRequestSchema", () => {
  it("parses a partial update with only permissionIds", () => {
    const parsed = RoleUpdateRequestSchema.parse({
      permissionIds: ["api_route:GET /admin/audit:read"],
    });
    expect(parsed.permissionIds).toHaveLength(1);
  });

  it("rejects an empty description when provided", () => {
    expect(() => RoleUpdateRequestSchema.parse({ description: "" })).toThrow();
  });
});

describe("RoleListResponseSchema", () => {
  it("parses a role list", () => {
    const parsed = RoleListResponseSchema.parse({ roles: [role] });
    expect(parsed.roles[0].name).toBe("ops");
  });

  it("rejects a non-array roles field", () => {
    expect(() => RoleListResponseSchema.parse({ roles: role })).toThrow();
  });
});

describe("PermissionListResponseSchema", () => {
  it("parses a permission list", () => {
    const parsed = PermissionListResponseSchema.parse({
      permissions: [permissionRecord],
    });
    expect(parsed.permissions[0].action).toBe("read");
  });

  it("rejects a missing permissions field", () => {
    expect(() => PermissionListResponseSchema.parse({})).toThrow();
  });
});
