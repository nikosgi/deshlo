import {
  injectSourceInspectorLoader,
  isSourceInspectorEnabled,
  type SourceInspectorAdapter,
  type SourceInspectorAdapterOptions,
} from "@couch-heroes/source-inspector-core";

export interface NextJsLikeConfig {
  webpack?: (config: any, context: any) => any;
  [key: string]: unknown;
}

export function withNextjsSourceInspector(
  nextConfig: NextJsLikeConfig = {},
  options: SourceInspectorAdapterOptions = {}
): NextJsLikeConfig {
  if (!isSourceInspectorEnabled(options)) {
    return nextConfig;
  }

  const existingWebpack = nextConfig.webpack;

  return {
    ...nextConfig,
    webpack(config, context) {
      injectSourceInspectorLoader(config, options);

      if (!existingWebpack) {
        return config;
      }

      return existingWebpack(config, context);
    },
  };
}

export const nextjsAdapter: SourceInspectorAdapter<NextJsLikeConfig> = {
  id: "nextjs",
  apply: withNextjsSourceInspector,
};

// Backward-compatible alias.
export const withSourceInspector = withNextjsSourceInspector;
