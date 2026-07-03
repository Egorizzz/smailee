import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone-сборка нужна для компактного Docker-образа (Amvera)
  output: "standalone",
};

export default nextConfig;
