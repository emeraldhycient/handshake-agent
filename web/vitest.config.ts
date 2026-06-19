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
  },
})
