import path from "node:path";

export interface SourceInspectorAdapterOptions {
  enabled?: boolean;
  include?: string[];
  attributeName?: string;
  wrapLooseTextNodes?: boolean;
  annotateLeafNodesOnly?: boolean;
}

export interface SourceInspectorLoaderOptions {
  attributeName: string;
  wrapLooseTextNodes: boolean;
  annotateLeafNodesOnly: boolean;
  includePaths: string[];
}

export interface WebpackLikeConfig {
  module?: {
    rules?: unknown[];
  };
  [key: string]: unknown;
}

export interface SourceInspectorAdapter<TConfig = unknown> {
  id: string;
  apply: (config: TConfig, options?: SourceInspectorAdapterOptions) => TConfig;
}

export const DEFAULT_ATTRIBUTE_NAME = "data-src-loc";

export function buildSourceInspectorLoaderOptions(
  options: SourceInspectorAdapterOptions = {},
  cwd: string = process.cwd()
): SourceInspectorLoaderOptions {
  return {
    attributeName: options.attributeName ?? DEFAULT_ATTRIBUTE_NAME,
    wrapLooseTextNodes: options.wrapLooseTextNodes === true,
    annotateLeafNodesOnly: options.annotateLeafNodesOnly === true,
    includePaths: resolveIncludePaths(options.include, cwd),
  };
}

export function isSourceInspectorEnabled(options: SourceInspectorAdapterOptions): boolean {
  if (typeof options.enabled === "boolean") {
    return options.enabled;
  }

  return (
    process.env.NEXT_PUBLIC_SOURCE_INSPECTOR === "1" ||
    process.env.VITE_SOURCE_INSPECTOR === "1" ||
    process.env.SOURCE_INSPECTOR === "1"
  );
}

export function resolveIncludePaths(
  include: string[] | undefined,
  cwd: string = process.cwd()
): string[] {
  const entries = include && include.length > 0 ? include : [path.resolve(cwd, "src")];
  return entries.map((entry) => path.resolve(cwd, entry));
}

export function injectSourceInspectorLoader<TConfig extends WebpackLikeConfig>(
  webpackConfig: TConfig,
  options: SourceInspectorAdapterOptions = {},
  cwd: string = process.cwd()
): TConfig {
  const loaderOptions = buildSourceInspectorLoaderOptions(options, cwd);

  webpackConfig.module ??= {};
  webpackConfig.module.rules ??= [];

  webpackConfig.module.rules.unshift({
    test: /\.[jt]sx?$/,
    include: loaderOptions.includePaths,
    exclude: /node_modules/,
    enforce: "pre",
    use: [
      {
        loader: "@deshlo/loader",
        options: loaderOptions,
      },
    ],
  });

  return webpackConfig;
}
