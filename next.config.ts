import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/quit": ["./.env"],
  },
  serverExternalPackages: ["unpdf", "bcryptjs", "@prisma/client"],
  experimental: {
    serverActions: { bodySizeLimit: "55mb" },
  },
};

export default nextConfig;
