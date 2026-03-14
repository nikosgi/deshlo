import { existsSync } from "node:fs";
import path from "node:path";

export interface SourceInspectorAdapterOptions {
  enabled?: boolean;
  include?: string[];
  attributeName?: string;
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

function resolveLoaderPath(): string {
  const candidates = [
    // Built package layout: build/src/shared.js -> loader/jsx-source-loader.cjs
    path.resolve(__dirname, "../../loader/jsx-source-loader.cjs"),
    // Source layout (workspace development): src/shared.ts -> loader/jsx-source-loader.cjs
    path.resolve(__dirname, "../loader/jsx-source-loader.cjs"),
    // Consumer fallback when running directly from another cwd.
    path.resolve(
      process.cwd(),
      "node_modules/@couch-heroes/source-inspector-core/loader/jsx-source-loader.cjs"
    ),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

export function isSourceInspectorEnabled(options: SourceInspectorAdapterOptions): boolean {
  return options.enabled ?? process.env.NEXT_PUBLIC_SOURCE_INSPECTOR === "1";
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
  const include = resolveIncludePaths(options.include, cwd);
  const attributeName = options.attributeName ?? DEFAULT_ATTRIBUTE_NAME;

  webpackConfig.module ??= {};
  webpackConfig.module.rules ??= [];

  webpackConfig.module.rules.unshift({
    test: /\.[jt]sx?$/,
    include,
    exclude: /node_modules/,
    enforce: "pre",
    use: [
      {
        loader: resolveLoaderPath(),
        options: {
          attributeName,
        },
      },
    ],
  });

  return webpackConfig;
}
