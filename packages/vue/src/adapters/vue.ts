import {
  injectSourceInspectorLoader,
  isSourceInspectorEnabled,
  type SourceInspectorAdapter,
  type SourceInspectorAdapterOptions,
  type WebpackLikeConfig,
} from "@couch-heroes/source-inspector-core";

export function withVueSourceInspector<TConfig extends WebpackLikeConfig>(
  webpackConfig: TConfig,
  options: SourceInspectorAdapterOptions = {}
): TConfig {
  if (!isSourceInspectorEnabled(options)) {
    return webpackConfig;
  }

  return injectSourceInspectorLoader(webpackConfig, options);
}

export const vueAdapter: SourceInspectorAdapter<WebpackLikeConfig> = {
  id: "vue",
  apply: withVueSourceInspector,
};
