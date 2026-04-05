export type AnnotationTriggerKey = "alt" | "shift" | "meta" | "ctrl";

export type AnnotationThreadStatus = "open" | "resolved";

export interface AnnotationViewport {
  width: number;
  height: number;
}

export interface AnnotationPoint {
  x: number;
  y: number;
}

export interface AnnotationRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AnnotationContainerFingerprint {
  tagName: string;
  id?: string;
  role?: string;
  classTokens?: string[];
  dataAttributes?: Record<string, string>;
  domPath?: string;
}

export interface AnnotationLinkedElement {
  fingerprint: AnnotationContainerFingerprint;
  tagName: string;
  id?: string;
  className?: string;
  role?: string;
  textPreview?: string;
}

export interface AnnotationScrollChainNode {
  fingerprint: AnnotationContainerFingerprint;
  scrollTop: number;
  scrollLeft: number;
  offsetX: number;
  offsetY: number;
}

export interface AnnotationAnchor {
  viewport: AnnotationViewport;
  pageScroll: AnnotationPoint;
  targetRect: AnnotationRect;
  targetPoint: AnnotationPoint;
  normalized: {
    viewportXRatio: number;
    viewportYRatio: number;
    rectXRatio: number;
    rectYRatio: number;
  };
  scrollChain: AnnotationScrollChainNode[];
  linkedElement?: AnnotationLinkedElement;
}

export interface AnnotationMessage {
  messageId: string;
  body: string;
  author?: string;
  createdAt: string;
}

export interface AnnotationThread {
  threadId: string;
  projectId?: string;
  environment?: string;
  pageKey: string;
  commitSha: string;
  status: AnnotationThreadStatus;
  anchor: AnnotationAnchor;
  messages: AnnotationMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationResultLink {
  label: string;
  url: string;
}

export interface AnnotationActionResult {
  ok: boolean;
  message: string;
  links?: AnnotationResultLink[];
}

export interface AnnotationPluginContext {
  host: string;
  pageKey: string;
  commitSha: string;
  projectId?: string;
  environment?: string;
}

export interface AnnotationListThreadsInput {
  includeStale?: boolean;
}

export interface AnnotationCreateThreadInput {
  pageKey: string;
  commitSha: string;
  anchor: AnnotationAnchor;
  body: string;
  author?: string;
  projectId?: string;
  environment?: string;
}

export interface AnnotationReplyThreadInput {
  threadId: string;
  pageKey: string;
  commitSha: string;
  body: string;
  author?: string;
}

export interface AnnotationThreadActionInput {
  threadId: string;
  pageKey: string;
  commitSha: string;
}

export interface AnnotationMoveThreadAnchorInput {
  threadId: string;
  pageKey: string;
  commitSha: string;
  anchor: AnnotationAnchor;
}

export interface AnnotationDeleteThreadInput {
  threadId: string;
  pageKey: string;
  commitSha: string;
}

export type AnnotationListThreadsHandler = (
  input: AnnotationListThreadsInput,
  context: AnnotationPluginContext
) => Promise<AnnotationThread[]> | AnnotationThread[];

export type AnnotationCreateThreadHandler = (
  input: AnnotationCreateThreadInput,
  context: AnnotationPluginContext
) => Promise<AnnotationActionResult> | AnnotationActionResult;

export type AnnotationReplyThreadHandler = (
  input: AnnotationReplyThreadInput,
  context: AnnotationPluginContext
) => Promise<AnnotationActionResult> | AnnotationActionResult;

export type AnnotationThreadActionHandler = (
  input: AnnotationThreadActionInput,
  context: AnnotationPluginContext
) => Promise<AnnotationActionResult> | AnnotationActionResult;

export type AnnotationMoveThreadAnchorHandler = (
  input: AnnotationMoveThreadAnchorInput,
  context: AnnotationPluginContext
) => Promise<AnnotationActionResult> | AnnotationActionResult;

export type AnnotationDeleteThreadHandler = (
  input: AnnotationDeleteThreadInput,
  context: AnnotationPluginContext
) => Promise<AnnotationActionResult> | AnnotationActionResult;

export interface AnnotationPlugin {
  id: string;
  listThreads: AnnotationListThreadsHandler;
  createThread: AnnotationCreateThreadHandler;
  replyToThread: AnnotationReplyThreadHandler;
  resolveThread: AnnotationThreadActionHandler;
  reopenThread: AnnotationThreadActionHandler;
  moveThreadAnchor?: AnnotationMoveThreadAnchorHandler;
  deleteThread?: AnnotationDeleteThreadHandler;
}

export function normalizeAnnotationText(value: string): string {
  return value.trim();
}

export function buildAnnotationPageKey(url: { origin: string; pathname: string }): string {
  return `${url.origin}${url.pathname}`;
}

export function toAnnotationErrorResult(error: unknown): AnnotationActionResult {
  if (error instanceof Error) {
    return {
      ok: false,
      message: error.message,
    };
  }

  return {
    ok: false,
    message: "Unexpected annotation provider error.",
  };
}
