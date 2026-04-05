import type {
  AnnotationCreateThreadHandler,
  AnnotationDeleteThreadHandler,
  AnnotationListThreadsHandler,
  AnnotationMoveThreadAnchorHandler,
  AnnotationPlugin,
  AnnotationReplyThreadHandler,
  AnnotationThreadActionHandler,
} from "./annotation-plugin";

export interface AnnotationCallbacks {
  onListThreads?: AnnotationListThreadsHandler;
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
