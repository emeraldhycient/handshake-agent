import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // The shared contracts package is source-only (.ts) — Next must transpile it.
  transpilePackages: ["@handshake-agent/contracts"],
}

export default nextConfig
