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
    // waitFor) run on real timers and are legitimately slow. Under `test:cov`
    // the v8 instrumentation roughly doubles their wall time, and the CI runner
    // executes api/web/web-admin coverage in parallel (turbo), so give the
    // suite headroom against the 5000ms default. Fast tests still finish fast.
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // Measure the code that carries logic — the lib/ data layer, feature
      // components, hooks and constants. Route files (app/) are thin
      // orchestrators and pages; primitives (components/ui) are generated.
      include: ["lib/**", "components/**", "hooks/**", "constants/**"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "**/*.config.*",
        "components/ui/**",
        "types/**",
        "e2e/**",
      ],
      // Measured baseline (all tests green): statements 88.24, branches 81.94,
      // functions 86.65, lines 89.18. Thresholds sit a few points below so the
      // gate is green today and ratchets against regression.
      thresholds: {
        statements: 85,
        branches: 79,
        functions: 83,
        lines: 86,
      },
    },
  },
})
