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
export {
  buildAnnotationPageKey,
  normalizeAnnotationText,
  toAnnotationErrorResult,
} from "./annotations";

export type {
  SourceInspectorAdapter,
  SourceInspectorAdapterOptions,
  SourceInspectorLoaderOptions,
  WebpackLikeConfig,
} from "./shared";
export type { InjectSourceAttributesOptions, InjectSourceAttributesResult } from "./transform";
export type {
  OverlayBatchSubmitHandler,
  OverlayBatchSubmitInput,
  OverlayBatchSubmitResult,
  OverlayListProposedChangesHandler,
  OverlayPlugin,
  OverlayPluginContext,
  OverlayProposedChange,
  OverlayResultLink,
  OverlaySelection,
  OverlaySubmitHandler,
  OverlaySubmitInput,
  OverlaySubmitResult,
  TriggerKey,
} from "./overlay-plugin";
export type {
  AnnotationActionResult,
  AnnotationAnchor,
  AnnotationContainerFingerprint,
  AnnotationCreateThreadHandler,
  AnnotationCreateThreadInput,
  AnnotationListThreadsHandler,
  AnnotationListThreadsInput,
  AnnotationMessage,
  AnnotationMoveThreadAnchorHandler,
  AnnotationMoveThreadAnchorInput,
  AnnotationPlugin,
  AnnotationPluginContext,
  AnnotationPoint,
  AnnotationRect,
  AnnotationReplyThreadHandler,
  AnnotationReplyThreadInput,
  AnnotationResultLink,
  AnnotationDeleteThreadHandler,
  AnnotationDeleteThreadInput,
  AnnotationScrollChainNode,
  AnnotationThread,
  AnnotationThreadActionHandler,
  AnnotationThreadActionInput,
  AnnotationThreadStatus,
  AnnotationTriggerKey,
  AnnotationViewport,
} from "./annotations";
