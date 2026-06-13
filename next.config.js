/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [],
  },
  async headers() {
    return [
      {
        // Required so the SW at /sw.js can claim scope "/"
        source: "/sw.js",
        headers: [
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Cache-Control",          value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
