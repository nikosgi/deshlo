import type {
  AnnotationCreateThreadHandler,
  AnnotationDeleteThreadHandler,
  AnnotationListCommitHistoryHandler,
  AnnotationListThreadsHandler,
  AnnotationMoveThreadAnchorHandler,
  AnnotationPlugin,
  AnnotationReplyThreadHandler,
  AnnotationThreadActionHandler,
} from "./annotation-plugin";

export interface AnnotationCallbacks {
  onListThreads?: AnnotationListThreadsHandler;
  onListCommitHistory?: AnnotationListCommitHistoryHandler;
  onCreateThread?: AnnotationCreateThreadHandler;
  onReplyToThread?: AnnotationReplyThreadHandler;
  onResolveThread?: AnnotationThreadActionHandler;
  onReopenThread?: AnnotationThreadActionHandler;
  onMoveThreadAnchor?: AnnotationMoveThreadAnchorHandler;
  onDeleteThread?: AnnotationDeleteThreadHandler;
}

export interface ResolvedAnnotationHandlers {
  pluginId: string;
  listThreads?: AnnotationListThreadsHandler;
  listCommitHistory?: AnnotationListCommitHistoryHandler;
  createThread?: AnnotationCreateThreadHandler;
  replyToThread?: AnnotationReplyThreadHandler;
  resolveThread?: AnnotationThreadActionHandler;
  reopenThread?: AnnotationThreadActionHandler;
  moveThreadAnchor?: AnnotationMoveThreadAnchorHandler;
  deleteThread?: AnnotationDeleteThreadHandler;
}

export function resolveAnnotationHandlers(
  plugin: AnnotationPlugin | null,
  callbacks: AnnotationCallbacks
): ResolvedAnnotationHandlers {
  if (plugin) {
    return {
      pluginId: plugin.id,
      listThreads: plugin.listThreads,
      listCommitHistory: plugin.listCommitHistory,
      createThread: plugin.createThread,
      replyToThread: plugin.replyToThread,
      resolveThread: plugin.resolveThread,
      reopenThread: plugin.reopenThread,
      moveThreadAnchor: plugin.moveThreadAnchor,
      deleteThread: plugin.deleteThread,
    };
  }

  if (
    callbacks.onListThreads ||
    callbacks.onListCommitHistory ||
    callbacks.onCreateThread ||
    callbacks.onReplyToThread ||
    callbacks.onResolveThread ||
    callbacks.onReopenThread ||
    callbacks.onMoveThreadAnchor ||
    callbacks.onDeleteThread
  ) {
    return {
      pluginId: "custom-callbacks",
      listThreads: callbacks.onListThreads,
      listCommitHistory: callbacks.onListCommitHistory,
      createThread: callbacks.onCreateThread,
      replyToThread: callbacks.onReplyToThread,
      resolveThread: callbacks.onResolveThread,
      reopenThread: callbacks.onReopenThread,
      moveThreadAnchor: callbacks.onMoveThreadAnchor,
      deleteThread: callbacks.onDeleteThread,
    };
  }

  return {
    pluginId: "unconfigured",
  };
}
