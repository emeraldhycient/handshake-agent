/** @type {import('dependency-cruiser').IConfiguration} */
// Per-package layering rules for the admin app, mirroring web's (which live in
// the root .dependency-cruiser.cjs). The monorepo `pnpm depcruise` run uses the
// root config; this local copy keeps the rules discoverable from within the
// package and usable for a package-scoped `depcruise .` invocation.
module.exports = {
  forbidden: [
    {
      name: "web-admin-components-no-app",
      comment:
        "web-admin components must not import from app/ (app composes components, never the reverse).",
      severity: "error",
      from: { path: "^(web-admin/)?(src/)?components/" },
      to: { path: "^(web-admin/)?(src/)?app/" },
    },
    {
      name: "web-admin-lib-no-components",
      comment:
        "web-admin lib must not import from components (lib is lower in the stack and framework-agnostic).",
      severity: "error",
      from: { path: "^(web-admin/)?(src/)?lib/" },
      to: { path: "^(web-admin/)?(src/)?components/" },
    },
    {
      name: "no-circular",
      comment: "No circular dependencies anywhere.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(generated|dist|\\.next|coverage)/" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".js", ".jsx", ".ts", ".tsx", ".d.ts"],
    },
  },
}
