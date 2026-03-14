const { withSourceInspector } = require("@fdb/nextjs");

const nextConfig = {
  reactStrictMode: true,
};

module.exports = withSourceInspector(nextConfig, {
  enabled: process.env.NEXT_PUBLIC_SOURCE_INSPECTOR === "1",
  include: ["app"],
});
