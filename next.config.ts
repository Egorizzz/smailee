import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone-сборка нужна для компактного Docker-образа (Amvera)
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // UI accepts files up to 10 MB; multipart framing needs a small margin.
    serverActions: { bodySizeLimit: "11mb" },
  },
};

export default nextConfig;
