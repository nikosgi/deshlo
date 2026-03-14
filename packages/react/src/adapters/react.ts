import {
  injectSourceInspectorLoader,
  isSourceInspectorEnabled,
  type SourceInspectorAdapter,
  type SourceInspectorAdapterOptions,
  type WebpackLikeConfig,
} from "@couch-heroes/source-inspector-core";

export function withReactSourceInspector<TConfig extends WebpackLikeConfig>(
  webpackConfig: TConfig,
  options: SourceInspectorAdapterOptions = {}
): TConfig {
  if (!isSourceInspectorEnabled(options)) {
    return webpackConfig;
  }

  return injectSourceInspectorLoader(webpackConfig, options);
}

export const reactAdapter: SourceInspectorAdapter<WebpackLikeConfig> = {
  id: "react",
  apply: withReactSourceInspector,
};
