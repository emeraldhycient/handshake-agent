/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Scopes map to workspaces and cross-cutting areas. Keep this list in sync
    // with the monorepo structure; an unknown scope is allowed but discouraged.
    'scope-enum': [
      1,
      'always',
      ['api', 'web', 'contracts', 'agent', 'config', 'ci', 'deps', 'repo', 'docs'],
    ],
  },
}
