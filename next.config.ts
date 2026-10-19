import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/quit": ["./.env"],
  },
  serverExternalPackages: ["unpdf", "bcryptjs", "@prisma/client", "tesseract.js", "tesseract.js-core"],
  experimental: {
    serverActions: { bodySizeLimit: "55mb" },
  },
};

export default nextConfig;
