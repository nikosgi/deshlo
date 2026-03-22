import {
  injectSourceInspectorLoader,
  isSourceInspectorEnabled,
  type SourceInspectorAdapter,
  type SourceInspectorAdapterOptions,
  type WebpackLikeConfig,
} from "@deshlo/core";

export function withSourceInspectorWebpack<TConfig extends WebpackLikeConfig>(
  webpackConfig: TConfig,
  options: SourceInspectorAdapterOptions = {}
): TConfig {
  if (!isSourceInspectorEnabled(options)) {
    return webpackConfig;
  }

  return injectSourceInspectorLoader(webpackConfig, options);
}

export const webpackAdapter: SourceInspectorAdapter<WebpackLikeConfig> = {
  id: "webpack",
  apply: withSourceInspectorWebpack,
};

export type {
  SourceInspectorAdapter,
  SourceInspectorAdapterOptions,
  WebpackLikeConfig,
} from "@deshlo/core";
