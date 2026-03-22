import { createSourceInspectorTurbopackRules, withSourceInspectorWebpack } from "@deshlo/nextjs";

const sourceInspectorOptions = {
  enabled: process.env.NEXT_PUBLIC_SOURCE_INSPECTOR === "1",
  include: ["app", "components"],
  wrapLooseTextNodes: true,
  annotateLeafNodesOnly: true,
};

module.exports = {
  reactStrictMode: true,
  webpack(config: any) {
    return withSourceInspectorWebpack(config, sourceInspectorOptions);
  },
  turbopack: {
    rules: createSourceInspectorTurbopackRules(sourceInspectorOptions),
  },
};
