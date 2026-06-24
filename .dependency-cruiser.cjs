/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'api-application-no-infra',
      comment:
        'API application layer must depend on abstractions, not details: no import of infrastructure or @prisma/client.',
      severity: 'error',
      from: { path: '^api/src/modules/[^/]+/application/' },
      to: {
        path: [
          '^api/src/modules/[^/]+/infrastructure/',
          '^@prisma/client$',
          '/node_modules/@prisma/client/',
          '^api/generated/prisma',
        ],
      },
    },
    {
      name: 'api-agent-never-prisma',
      comment:
        'The agent module must NEVER touch the database (CLAUDE.md §3.2) — no @prisma/client / generated client anywhere under agent/, including its thin Nest adapter.',
      severity: 'error',
      from: { path: '^api/src/(modules/)?agent/' },
      to: {
        path: [
          '^@prisma/client$',
          '/node_modules/@prisma/client/',
          '^api/generated/prisma',
        ],
      },
    },
    {
      name: 'api-agent-pure-layers-no-infra',
      comment:
        'The agent core/application layers reach capabilities only through injected ports — no import of any infrastructure (including the agent’s own). The thin Nest composition root (agent.module.ts) binds the adapter; the pure layers never see it.',
      severity: 'error',
      from: { path: '^api/src/modules/agent/(core|application)/' },
      to: { path: '^api/src/modules/[^/]+/infrastructure/' },
    },
    {
      name: 'api-agent-core-no-nest',
      comment:
        'The agent core is framework-agnostic (CLAUDE.md §3.2/§6): it must import zero Nest symbols. Nest wiring belongs in the adapter layer (Task 3.3).',
      severity: 'error',
      from: { path: '^api/src/modules/agent/core/' },
      to: { path: '^@nestjs/' },
    },
    {
      name: 'api-domain-is-pure',
      comment:
        'Domain layer is pure: no Nest, no Prisma, no framework imports.',
      severity: 'error',
      from: { path: '^api/src/modules/[^/]+/domain/' },
      to: { path: ['^@nestjs/', '^@prisma/client$', '/node_modules/@prisma/client/', '^api/generated/prisma'] },
    },
    {
      name: 'web-components-no-app',
      comment:
        'web components must not import from app/ (app composes components, never the reverse).',
      severity: 'error',
      from: { path: '^web/(src/)?components/' },
      to: { path: '^web/(src/)?app/' },
    },
    {
      name: 'web-lib-no-components',
      comment:
        'web lib must not import from components (lib is lower in the stack and framework-agnostic).',
      severity: 'error',
      from: { path: '^web/(src/)?lib/' },
      to: { path: '^web/(src/)?components/' },
    },
    {
      name: 'no-circular',
      comment: 'No circular dependencies anywhere in the monorepo.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Never lint generated or build output (e.g. the Prisma client, which has
    // internal circular refs by design).
    exclude: { path: '(^|/)(generated|dist|\\.next|coverage)/' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.d.ts'],
    },
  },
}
