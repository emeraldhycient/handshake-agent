/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "api-application-no-infra",
      comment:
        "API application layer must depend on abstractions, not details: no import of infrastructure, @prisma/client, or the PrismaService wrapper.",
      severity: "error",
      from: { path: "^api/src/modules/[^/]+/application/" },
      to: {
        path: [
          "^api/src/modules/[^/]+/infrastructure/",
          "^@prisma/client$",
          "/node_modules/@prisma/client/",
          "^api/generated/prisma",
          "^api/src/core/prisma",
        ],
      },
    },
    {
      name: "api-presentation-no-infra",
      comment:
        "API presentation layer talks to application services only (presentation → application → domain, CLAUDE.md §4.1): no import of any infrastructure layer.",
      severity: "error",
      from: { path: "^api/src/modules/[^/]+/presentation/" },
      to: { path: "^api/src/modules/[^/]+/infrastructure/" },
    },
    {
      name: "api-agent-never-prisma",
      comment:
        "The agent module must NEVER touch the database (CLAUDE.md §3.2) — no @prisma/client / generated client / PrismaService anywhere under agent/, including its thin Nest adapter.",
      severity: "error",
      from: { path: "^api/src/(modules/)?agent/" },
      to: {
        path: [
          "^@prisma/client$",
          "/node_modules/@prisma/client/",
          "^api/generated/prisma",
          "^api/src/core/prisma",
        ],
      },
    },
    {
      name: "api-agent-pure-layers-no-infra",
      comment:
        "The agent core/application layers reach capabilities only through injected ports — no import of any infrastructure (including the agent’s own). The thin Nest composition root (agent.module.ts) binds the adapter; the pure layers never see it.",
      severity: "error",
      from: { path: "^api/src/modules/agent/(core|application)/" },
      to: { path: "^api/src/modules/[^/]+/infrastructure/" },
    },
    {
      name: "api-agent-core-no-nest",
      comment:
        "The agent core is framework-agnostic (CLAUDE.md §3.2/§6): it must import zero Nest symbols. Nest wiring belongs in the adapter layer (Task 3.3).",
      severity: "error",
      from: { path: "^api/src/modules/agent/core/" },
      to: { path: "^@nestjs/" },
    },
    {
      name: "api-domain-is-pure",
      comment:
        "Domain layer is pure: no Nest, no Prisma, no framework imports.",
      severity: "error",
      from: { path: "^api/src/modules/[^/]+/domain/" },
      to: {
        path: [
          "^@nestjs/",
          "^@prisma/client$",
          "/node_modules/@prisma/client/",
          "^api/generated/prisma",
          "^api/src/core/prisma",
        ],
      },
    },
    {
      name: "web-components-no-app",
      comment:
        "web components must not import from app/ (app composes components, never the reverse).",
      severity: "error",
      from: { path: "^web/(src/)?components/" },
      to: { path: "^web/(src/)?app/" },
    },
    {
      name: "web-lib-no-components",
      comment:
        "web lib must not import from components (lib is lower in the stack and framework-agnostic).",
      severity: "error",
      from: { path: "^web/(src/)?lib/" },
      to: { path: "^web/(src/)?components/" },
    },
    {
      name: "web-hooks-constants-types-no-ui",
      comment:
        "web hooks/, constants/ and types/ sit alongside lib/ at the bottom of the stack (CLAUDE.md §16): they must not import from components/ or app/.",
      severity: "error",
      from: { path: "^web/(src/)?(hooks|constants|types)/" },
      to: { path: "^web/(src/)?(components|app)/" },
    },
    {
      name: "web-admin-components-no-app",
      comment:
        "web-admin components must not import from app/ (app composes components, never the reverse).",
      severity: "error",
      from: { path: "^web-admin/(src/)?components/" },
      to: { path: "^web-admin/(src/)?app/" },
    },
    {
      name: "web-admin-lib-no-components",
      comment:
        "web-admin lib must not import from components (lib is lower in the stack and framework-agnostic).",
      severity: "error",
      from: { path: "^web-admin/(src/)?lib/" },
      to: { path: "^web-admin/(src/)?components/" },
    },
    {
      name: "web-admin-hooks-constants-types-no-ui",
      comment:
        "web-admin hooks/, constants/ and types/ sit alongside lib/ at the bottom of the stack (CLAUDE.md §16): they must not import from components/ or app/.",
      severity: "error",
      from: { path: "^web-admin/(src/)?(hooks|constants|types)/" },
      to: { path: "^web-admin/(src/)?(components|app)/" },
    },
    {
      name: "web-no-cross-app",
      comment:
        "Apps are isolated: web never imports web-admin or api code — shared shapes live in packages/contracts.",
      severity: "error",
      from: { path: "^web/" },
      to: { path: ["^web-admin/", "^api/"] },
    },
    {
      name: "web-admin-no-cross-app",
      comment:
        "Apps are isolated: web-admin never imports web or api code — shared shapes live in packages/contracts.",
      severity: "error",
      from: { path: "^web-admin/" },
      to: { path: ["^web/", "^api/"] },
    },
    {
      name: "api-no-cross-app",
      comment:
        "Apps are isolated: api never imports web or web-admin code — shared shapes live in packages/contracts.",
      severity: "error",
      from: { path: "^api/" },
      to: { path: ["^web/", "^web-admin/"] },
    },
    {
      name: "no-circular",
      comment: "No circular dependencies anywhere in the monorepo.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    // Keep generated output (e.g. the Prisma client) visible as a rule target
    // (§3.2 rules match '^api/generated/prisma') but never cruise inside it —
    // it has internal circular refs by design. `exclude` would erase those
    // modules from the graph entirely and silently disable the rules.
    doNotFollow: { path: "node_modules|(^|/)generated/" },
    // Build output is never linted.
    exclude: { path: "(^|/)(dist|\\.next|coverage)/" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".js", ".jsx", ".ts", ".tsx", ".d.ts"],
    },
  },
};
