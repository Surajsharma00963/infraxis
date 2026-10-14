import type { NextConfig } from "next";

import path from "path";

const CI_BACKEND_URL = process.env.CI_BACKEND_URL || "http://127.0.0.1:8787";
const isBuild =
  process.env.NODE_ENV === "production" ||
  process.argv.includes("build") ||
  process.env.npm_lifecycle_event === "build";

const nextConfig: NextConfig = {
  ...(isBuild ? { output: "export" as const } : {}),
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "172.16.0.132",
    "172.16.*.*",
    "192.168.*.*",
    "10.*.*.*",
    "*.local",
  ],
  turbopack: {
    root: path.resolve(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${CI_BACKEND_URL}/api/:path*`,
      },
      {
        source: "/health",
        destination: `${CI_BACKEND_URL}/health`,
      },
    ];
  },
};

export default nextConfig;
