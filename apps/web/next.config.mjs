/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@pebble/core", "@pebble/bb", "@pebble/panels", "@pebble/pipelines"],

  // The workspace packages are authored as ESM TypeScript that imports with
  // explicit ".js" specifiers (NodeNext style). Webpack/Turbopack need to be
  // told that a ".js" import may resolve to the ".ts"/".tsx" source on disk.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },

  turbopack: {
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
  },
};

export default nextConfig;
