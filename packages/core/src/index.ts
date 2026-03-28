export {
  buildSourceInspectorLoaderOptions,
  DEFAULT_ATTRIBUTE_NAME,
  DEFAULT_REVISION_ATTRIBUTE_NAME,
  injectSourceInspectorLoader,
  isSourceInspectorEnabled,
  resolveIncludePaths,
} from "./shared";
export { injectSourceAttributes } from "./transform";
export {
  buildOverlaySubmitInput,
  normalizeOverlayText,
  toOverlayErrorResult,
} from "./overlay-plugin";
export type {
  SourceInspectorAdapter,
  SourceInspectorAdapterOptions,
  SourceInspectorLoaderOptions,
  WebpackLikeConfig,
} from "./shared";
export type { InjectSourceAttributesOptions, InjectSourceAttributesResult } from "./transform";
export type {
  OverlayPlugin,
  OverlayPluginContext,
  OverlayProposedChange,
  OverlayResultLink,
  OverlaySelection,
  OverlayListProposedChangesHandler,
  OverlaySubmitHandler,
  OverlaySubmitInput,
  OverlaySubmitResult,
  TriggerKey,
} from "./overlay-plugin";
