/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'api-application-no-infra',
      comment:
        'API application layer must depend on abstractions, not details: no import of infrastructure or @prisma/client.',
      severity: 'error',
      from: { path: '^api/src/(modules/[^/]+/)?application/' },
      to: {
        path: [
          '^api/src/(modules/[^/]+/)?infrastructure/',
          '^@prisma/client$',
          '/node_modules/@prisma/client/',
          '^api/generated/prisma',
        ],
      },
    },
    {
      name: 'api-agent-no-infra-or-prisma',
      comment:
        'The agent module must never touch the database: no import of infrastructure or @prisma/client. It reaches data only through injected ports.',
      severity: 'error',
      from: { path: '^api/src/(modules/)?agent/' },
      to: {
        path: [
          '^api/src/(modules/[^/]+/)?infrastructure/',
          '^@prisma/client$',
          '/node_modules/@prisma/client/',
          '^api/generated/prisma',
        ],
      },
    },
    {
      name: 'api-domain-is-pure',
      comment:
        'Domain layer is pure: no Nest, no Prisma, no framework imports.',
      severity: 'error',
      from: { path: '^api/src/(modules/[^/]+/)?domain/' },
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
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.d.ts'],
    },
  },
}
