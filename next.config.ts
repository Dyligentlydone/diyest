import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // manifold-3d ships a .wasm binary — serve it as an external package
  // rather than letting the bundler mangle its loader.
  serverExternalPackages: ["manifold-3d"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
