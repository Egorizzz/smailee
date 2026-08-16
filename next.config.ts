import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone-сборка нужна для компактного Docker-образа (Amvera)
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
