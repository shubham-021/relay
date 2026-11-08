import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["bun:sqlite"],
  async headers() {
    return [
      {
        source: "/api/thumbnails/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable"
          }
        ]
      }
    ]
  }
};

export default nextConfig;
