const { defineConfig } = require("vite");
const react = require("@vitejs/plugin-react");
const { withSourceInspectorVite } = require("@deshlo/react/vite");

module.exports = defineConfig({
  plugins: [
    withSourceInspectorVite({
      enabled: process.env.VITE_SOURCE_INSPECTOR === "1",
      cwd: __dirname,
      include: ["src"],
      attributeName: "data-src-loc",
    }),
    react(),
  ],
});
