import type { NextConfig } from "next";

// `output: standalone` is only wanted for local/self-hosted Docker-style runs.
// Netlify's Next runtime and Vercel both build the standard .next output
// (each platform sets its own build env flag), so standalone is disabled there.
const isManagedBuild = Boolean(
  process.env.NETLIFY || process.env.NETLIFY_LOCAL || process.env.VERCEL
);

const nextConfig: NextConfig = {
  ...(isManagedBuild ? {} : { output: "standalone" as const }),
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
