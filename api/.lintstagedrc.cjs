// Runs from api/, so ESLint resolves api/eslint.config.mjs and Prettier resolves api/.prettierrc.
/** @type {import('lint-staged').Configuration} */
module.exports = {
  '*.ts': ['eslint --fix', 'prettier --write'],
  '*.{json,md}': ['prettier --write'],
};
