// Runs from web/, so ESLint resolves web/eslint.config.mjs and Prettier resolves web/.prettierrc.
/** @type {import('lint-staged').Configuration} */
module.exports = {
  '*.{ts,tsx}': ['eslint --fix', 'prettier --write'],
  '*.{css,json,md}': ['prettier --write'],
}
