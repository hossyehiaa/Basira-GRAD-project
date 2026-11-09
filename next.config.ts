import type { NextConfig } from "next";

// `output: standalone` is only wanted for local/self-hosted Docker-style runs.
// Netlify's Next runtime builds the standard .next output, so we disable it there.
const isNetlify = Boolean(process.env.NETLIFY || process.env.NETLIFY_LOCAL);

const nextConfig: NextConfig = {
  ...(isNetlify ? {} : { output: "standalone" as const }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  images: {
    // Overlay PNGs and GEE tile endpoints are served as-is
    unoptimized: true,
  },
};

export default nextConfig;
