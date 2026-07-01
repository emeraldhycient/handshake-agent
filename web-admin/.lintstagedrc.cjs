// Runs from web-admin/, so ESLint resolves web-admin/eslint.config.mjs and Prettier resolves web-admin/.prettierrc.
/** @type {import('lint-staged').Configuration} */
module.exports = {
  '*.{ts,tsx}': ['eslint --fix', 'prettier --write'],
  '*.{css,json,md}': ['prettier --write'],
}
