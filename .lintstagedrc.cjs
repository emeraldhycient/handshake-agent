// Root config: handles repo-level files only. Each workspace (api/, web/) has its
// own .lintstagedrc.cjs so ESLint's flat config and Prettier config resolve from
// that package's directory (lint-staged runs the closest config to each staged file).
/** @type {import('lint-staged').Configuration} */
module.exports = {
  "*.{json,md,yaml,yml}": ["prettier --write"],
};
