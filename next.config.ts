import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["postgres", "@electric-sql/pglite", "unpdf"],
  // A SIMAH report is uploaded as a PDF through a server action. The file is at most 4 MB (REPORT_MAX_BYTES).
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  // Files read from disk at run time: the migrations, and the in-memory Postgres used for demo data.
  outputFileTracingIncludes: {
    "/**": [
      "./db/migrations/**/*",
      "./node_modules/@electric-sql/pglite/dist/pglite.wasm",
      "./node_modules/@electric-sql/pglite/dist/pglite.data",
    ],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default config;
