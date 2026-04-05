export { default as AnnotationGate } from "./AnnotationGate";
export type { AnnotationGateProps } from "./AnnotationGate";

export {
  AnnotationPluginProvider,
  useAnnotationPlugin,
  type AnnotationPluginProviderProps,
} from "./annotation-plugin-provider";

export type {
  AnnotationActionResult,
  AnnotationAnchor,
  AnnotationContainerFingerprint,
  AnnotationLinkedElement,
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
} from "./annotation-plugin";

export {
  buildAnnotationPageKey,
  normalizeAnnotationText,
  toAnnotationErrorResult,
} from "./annotation-plugin";

export {
  createHttpAnnotationsPlugin,
  type HttpAnnotationsPluginConfig,
} from "./http";

export {
  HttpAnnotationsPlugin,
  type HttpAnnotationsPluginProps,
} from "./http-plugin";
