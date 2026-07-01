import { resolve } from "node:path"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // The shared contracts package is source-only (.ts) — Next must transpile it.
  transpilePackages: ["@handshake-agent/contracts"],
  // Pin file tracing to the monorepo root so Next traces files correctly and
  // stops warning about the multiple lockfiles it sees in a pnpm workspace.
  outputFileTracingRoot: resolve(__dirname, ".."),
}

export default nextConfig
