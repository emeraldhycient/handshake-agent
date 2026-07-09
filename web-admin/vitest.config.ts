import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Array form so the contracts bare import and its subpath exports
    // (e.g. `@handshake-agent/contracts/dto`) both resolve — Vite prefix
    // string-aliases would otherwise mis-resolve the subpaths.
    alias: [
      {
        find: /^@handshake-agent\/contracts$/,
        replacement: resolve(__dirname, "../packages/contracts/src/index.ts"),
      },
      {
        find: /^@handshake-agent\/contracts\/(.*)$/,
        replacement: resolve(__dirname, "../packages/contracts/src/$1"),
      },
      { find: /^@\/(.*)$/, replacement: resolve(__dirname, "./$1") },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e"],
    // Multi-step `userEvent` interaction tests (open dialog → type → submit →
    // waitFor) are legitimately slow and flake against the default 5000ms on a
    // loaded 2-core CI runner (e.g. admins-page createRole hit 5096ms). The
    // `test:cov` lane adds v8 instrumentation on top and runs alongside the
    // api/web coverage suites under turbo, so give it extra headroom. Fast
    // tests still finish fast. `test:cov` also drops file-parallelism so the
    // three coverage suites don't oversubscribe the CI runner's cores.
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // Measure the code that carries logic — the lib/ data layer, admin
      // components, constants. Route files (app/) are thin orchestrators;
      // primitives (components/ui) are generated.
      include: ["lib/**", "components/**", "constants/**"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "**/*.config.*",
        "components/ui/**",
        "types/**",
        "e2e/**",
      ],
      // Measured baseline (all tests green): statements 80.74, branches 76.84,
      // functions 77.46, lines 81.73. Thresholds sit a few points below so the
      // gate is green today and ratchets against regression.
      thresholds: {
        statements: 77,
        branches: 73,
        functions: 74,
        lines: 79,
      },
    },
  },
})
