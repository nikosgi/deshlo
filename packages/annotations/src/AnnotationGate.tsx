"use client";

import { useEffect, useMemo, useState } from "react";

import {
  buildAnnotationPageKey,
  toAnnotationErrorResult,
  type AnnotationActionResult,
  type AnnotationCreateThreadHandler,
  type AnnotationDeleteThreadHandler,
  type AnnotationListThreadsHandler,
  type AnnotationMoveThreadAnchorHandler,
  type AnnotationPoint,
  type AnnotationReplyThreadHandler,
  type AnnotationThread,
  type AnnotationThreadActionHandler,
  type AnnotationTriggerKey,
} from "./annotation-plugin";
import {
  captureAnnotationAnchor,
  resolveDeepestTargetAtPoint,
  resolveThreadPositions,
  toPointFromMouseEvent,
} from "./anchor";
import { AnnotationProvider, type AnnotationContextValue } from "./annotation-context";
import { useAnnotationPlugin } from "./annotation-plugin-provider";
import { resolveAnnotationHandlers } from "./resolve-annotation-handlers";
import { groupThreadsByRevision } from "./threads";
import { isKnownCommitSha } from "./commit";
import AnnotationBubbles from "./AnnotationBubbles";
import AnnotationPanel, { type AnnotationPanelProps } from "./AnnotationPanel";

const DEFAULT_REVISION_ATTRIBUTE_NAME = "data-src-rev";
const DEFAULT_TRIGGER_KEY: AnnotationTriggerKey = "alt";
const DESHLO_NAV_EVENT = "deshlo:navigation";
const DESHLO_HISTORY_PATCHED_FLAG = "__deshloHistoryPatched";
type RuntimeIdentity = {
  pageKey: string;
  host: string;
  commitSha: string;
};

const UNKNOWN_IDENTITY: RuntimeIdentity = {
  pageKey: "unknown://unknown",
  host: "unknown",
  commitSha: "unknown",
};

function isTriggerPressed(event: MouseEvent, triggerKey: AnnotationTriggerKey): boolean {
  switch (triggerKey) {
    case "alt":
      return event.altKey;
    case "shift":
      return event.shiftKey;
    case "meta":
      return event.metaKey;
    case "ctrl":
      return event.ctrlKey;
    default:
      return false;
  }
}

function resolveCurrentCommitSha(): string {
  if (typeof document === "undefined") {
    return "unknown";
  }

  const element = document.querySelector(`[${DEFAULT_REVISION_ATTRIBUTE_NAME}]`) as HTMLElement | null;
  const value = element?.getAttribute(DEFAULT_REVISION_ATTRIBUTE_NAME)?.trim();

  if (!value || value === "unknown") {
    return "unknown";
  }

  return value;
}

function resolveRuntimeIdentity(): RuntimeIdentity {
  if (typeof window === "undefined") {
    return UNKNOWN_IDENTITY;
  }

  return {
    pageKey: buildAnnotationPageKey(window.location),
    host: window.location.host,
    commitSha: resolveCurrentCommitSha(),
  };
}

function isInsideAnnotationUi(target: Element): boolean {
  return Boolean(target.closest("[data-deshlo-annotation-ui='1']"));
}

function ensureNavigationEventsPatched(): void {
  if (typeof window === "undefined") {
    return;
  }

  const historyWithFlag = window.history as History & {
    [DESHLO_HISTORY_PATCHED_FLAG]?: boolean;
  };
  if (historyWithFlag[DESHLO_HISTORY_PATCHED_FLAG]) {
    return;
  }

  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);
  let pendingNavigationEvent = false;
  const emitNavigation = () => {
    if (pendingNavigationEvent) {
      return;
    }
    pendingNavigationEvent = true;
    setTimeout(() => {
      pendingNavigationEvent = false;
      window.dispatchEvent(new Event(DESHLO_NAV_EVENT));
    }, 0);
  };

  window.history.pushState = ((...args: Parameters<History["pushState"]>) => {
    originalPushState(...args);
    emitNavigation();
  }) as History["pushState"];

  window.history.replaceState = ((...args: Parameters<History["replaceState"]>) => {
    originalReplaceState(...args);
    emitNavigation();
  }) as History["replaceState"];

  historyWithFlag[DESHLO_HISTORY_PATCHED_FLAG] = true;
}

export interface AnnotationGateProps extends AnnotationPanelProps {
  enabled?: boolean;
  triggerKey?: AnnotationTriggerKey;
  projectId?: string;
  environment?: string;
  author?: string;
  onListThreads?: AnnotationListThreadsHandler;
  onCreateThread?: AnnotationCreateThreadHandler;
  onReplyToThread?: AnnotationReplyThreadHandler;
  onResolveThread?: AnnotationThreadActionHandler;
  onReopenThread?: AnnotationThreadActionHandler;
  onMoveThreadAnchor?: AnnotationMoveThreadAnchorHandler;
  onDeleteThread?: AnnotationDeleteThreadHandler;
}

export default function AnnotationGate({
  width,
  enabled,
  triggerKey = DEFAULT_TRIGGER_KEY,
  projectId,
  environment,
  author,
  onListThreads,
  onCreateThread,
  onReplyToThread,
  onResolveThread,
  onReopenThread,
  onMoveThreadAnchor,
  onDeleteThread,
}: AnnotationGateProps) {
  const annotationEnabled =
    typeof enabled === "boolean"
      ? enabled
      : process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS === "1";

  const wrapperPlugin = useAnnotationPlugin();
  const handlers = resolveAnnotationHandlers(wrapperPlugin, {
    onListThreads,
    onCreateThread,
    onReplyToThread,
    onResolveThread,
    onReopenThread,
    onMoveThreadAnchor,
    onDeleteThread,
  });

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AnnotationActionResult | null>(null);
  const [threads, setThreads] = useState<AnnotationThread[]>([]);
  const [showStale, setShowStale] = useState(false);
  const [draft, setDraft] = useState<AnnotationContextValue["draft"]>(null);
  const [threadPositions, setThreadPositions] = useState<AnnotationContextValue["threadPositions"]>({});
  // Keep first render deterministic for SSR hydration; resolve real runtime identity after mount.
  const [identity, setIdentity] = useState(UNKNOWN_IDENTITY);

  const pageKey = identity.pageKey;
  const host = identity.host;
  const currentCommitSha = identity.commitSha;
  const readOnly = !isKnownCommitSha(currentCommitSha);

  const groupedThreads = useMemo(
    () => groupThreadsByRevision(threads, currentCommitSha),
    [threads, currentCommitSha]
  );

  async function refreshThreads(): Promise<void> {
    if (!pageKey || pageKey === "unknown://unknown") {
      setThreads([]);
      return;
    }

    const listThreads = handlers.listThreads;
    if (!listThreads) {
      setThreads([]);
      return;
    }

    setLoading(true);
    try {
      const nextThreads = await listThreads(
        {
          includeStale: true,
        },
        {
          host,
          pageKey,
          commitSha: currentCommitSha,
          projectId,
          environment,
        }
      );
      setThreads(nextThreads);
    } catch (error) {
      setThreads([]);
      setResult(toAnnotationErrorResult(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!annotationEnabled) {
      return;
    }

    ensureNavigationEventsPatched();

    let syncFrame = 0;
    const syncIdentity = () => {
      if (syncFrame) {
        cancelAnimationFrame(syncFrame);
      }
      syncFrame = requestAnimationFrame(() => {
        setIdentity(resolveRuntimeIdentity());
      });
    };

    const onNavigation = () => {
      syncIdentity();
      setTimeout(syncIdentity, 0);
    };

    syncIdentity();

    void refreshThreads();

    window.addEventListener("popstate", onNavigation);
    window.addEventListener("hashchange", onNavigation);
    window.addEventListener(DESHLO_NAV_EVENT, onNavigation);

    return () => {
      if (syncFrame) {
        cancelAnimationFrame(syncFrame);
      }
      window.removeEventListener("popstate", onNavigation);
      window.removeEventListener("hashchange", onNavigation);
      window.removeEventListener(DESHLO_NAV_EVENT, onNavigation);
    };
  }, [annotationEnabled, handlers.pluginId, pageKey, currentCommitSha]);

  useEffect(() => {
    // Hide previous-page bubbles immediately while reloading the new page threads.
    setThreads([]);
  }, [pageKey]);

  useEffect(() => {
    if (!annotationEnabled) {
      setThreadPositions({});
      return;
    }

    let frame = 0;

    const recompute = () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }

      frame = requestAnimationFrame(() => {
        setThreadPositions(resolveThreadPositions(threads));
      });
    };

    recompute();

    const onViewportChange = () => {
      recompute();
    };

    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);

    const observer = new MutationObserver(() => {
      recompute();
    });

    if (document.body) {
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    }

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      observer.disconnect();
    };
  }, [annotationEnabled, threads]);

  useEffect(() => {
    if (!annotationEnabled) {
      return;
    }

    const onClick = (event: MouseEvent) => {
      if (!isTriggerPressed(event, triggerKey)) {
        return;
      }

      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (isInsideAnnotationUi(target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (readOnly) {
        setResult({
          ok: false,
          message: "UNKNOWN_COMMIT: Cannot create annotations while commit SHA is unknown.",
        });
        return;
      }

      const point = toPointFromMouseEvent(event);
      const deepestTarget = resolveDeepestTargetAtPoint(point);
      if (!deepestTarget) {
        setResult({
          ok: false,
          message: "TARGET_NOT_FOUND: Could not resolve a linked element for this comment.",
        });
        return;
      }
      const anchor = captureAnnotationAnchor(deepestTarget, point);

      setDraft({
        anchor,
        top: point.y + 8,
        left: point.x + 8,
        body: "",
      });
      setResult(null);
    };

    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("click", onClick, true);
    };
  }, [annotationEnabled, triggerKey, readOnly]);

  async function submitDraft(): Promise<void> {
    if (!draft) {
      return;
    }

    if (readOnly) {
      setResult({
        ok: false,
        message: "UNKNOWN_COMMIT: Cannot create annotations while commit SHA is unknown.",
      });
      return;
    }

    if (!draft.body.trim()) {
      setResult({ ok: false, message: "Thread message cannot be empty." });
      return;
    }

    const createThread = handlers.createThread;
    if (!createThread) {
      setResult({ ok: false, message: "PROVIDER_ERROR: No createThread handler configured." });
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const nextResult = await createThread(
        {
          pageKey,
          commitSha: currentCommitSha,
          anchor: draft.anchor,
          body: draft.body.trim(),
          author,
          projectId,
          environment,
        },
        {
          host,
          pageKey,
          commitSha: currentCommitSha,
          projectId,
          environment,
        }
      );

      setResult(nextResult);
      if (nextResult.ok) {
        setDraft(null);
        await refreshThreads();
      }
    } catch (error) {
      setResult(toAnnotationErrorResult(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function replyToThread(threadId: string, body: string): Promise<void> {
    if (readOnly) {
      setResult({
        ok: false,
        message: "UNKNOWN_COMMIT: Cannot mutate annotations while commit SHA is unknown.",
      });
      return;
    }

    const replyHandler = handlers.replyToThread;
    if (!replyHandler) {
      setResult({ ok: false, message: "PROVIDER_ERROR: No replyToThread handler configured." });
      return;
    }

    const thread = threads.find((item) => item.threadId === threadId);
    if (!thread) {
      setResult({ ok: false, message: `THREAD_NOT_FOUND: ${threadId}` });
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const nextResult = await replyHandler(
        {
          threadId,
          pageKey,
          commitSha: thread.commitSha,
          body,
          author,
        },
        {
          host,
          pageKey,
          commitSha: thread.commitSha,
          projectId,
          environment,
        }
      );

      setResult(nextResult);
      if (nextResult.ok) {
        await refreshThreads();
      }
    } catch (error) {
      setResult(toAnnotationErrorResult(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function resolveThread(threadId: string, commitSha: string): Promise<void> {
    if (readOnly) {
      setResult({
        ok: false,
        message: "UNKNOWN_COMMIT: Cannot mutate annotations while commit SHA is unknown.",
      });
      return;
    }

    const resolveHandler = handlers.resolveThread;
    if (!resolveHandler) {
      setResult({ ok: false, message: "PROVIDER_ERROR: No resolveThread handler configured." });
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const nextResult = await resolveHandler(
        {
          threadId,
          pageKey,
          commitSha,
        },
        {
          host,
          pageKey,
          commitSha,
          projectId,
          environment,
        }
      );

      setResult(nextResult);
      if (nextResult.ok) {
        await refreshThreads();
      }
    } catch (error) {
      setResult(toAnnotationErrorResult(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function reopenThread(threadId: string, commitSha: string): Promise<void> {
    if (readOnly) {
      setResult({
        ok: false,
        message: "UNKNOWN_COMMIT: Cannot mutate annotations while commit SHA is unknown.",
      });
      return;
    }

    const reopenHandler = handlers.reopenThread;
    if (!reopenHandler) {
      setResult({ ok: false, message: "PROVIDER_ERROR: No reopenThread handler configured." });
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const nextResult = await reopenHandler(
        {
          threadId,
          pageKey,
          commitSha,
        },
        {
          host,
          pageKey,
          commitSha,
          projectId,
          environment,
        }
      );

      setResult(nextResult);
      if (nextResult.ok) {
        await refreshThreads();
      }
    } catch (error) {
      setResult(toAnnotationErrorResult(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function moveThreadAnchor(threadId: string, point: AnnotationPoint): Promise<void> {
    if (readOnly) {
      setResult({
        ok: false,
        message: "UNKNOWN_COMMIT: Cannot mutate annotations while commit SHA is unknown.",
      });
      return;
    }

    const moveHandler = handlers.moveThreadAnchor;
    if (!moveHandler) {
      setResult({ ok: false, message: "PROVIDER_ERROR: No moveThreadAnchor handler configured." });
      return;
    }

    const thread = threads.find((item) => item.threadId === threadId);
    if (!thread) {
      setResult({ ok: false, message: `THREAD_NOT_FOUND: ${threadId}` });
      return;
    }

    const deepestTarget = resolveDeepestTargetAtPoint(point);
    if (!deepestTarget) {
      setResult({ ok: false, message: "TARGET_NOT_FOUND: Could not resolve drop target element." });
      return;
    }

    const nextAnchor = captureAnnotationAnchor(deepestTarget, point);
    const previousAnchor = thread.anchor;

    setThreads((previous) =>
      previous.map((item) =>
        item.threadId === threadId ? { ...item, anchor: nextAnchor } : item
      )
    );

    setSubmitting(true);
    setResult(null);

    try {
      const nextResult = await moveHandler(
        {
          threadId,
          pageKey,
          commitSha: thread.commitSha,
          anchor: nextAnchor,
        },
        {
          host,
          pageKey,
          commitSha: thread.commitSha,
          projectId,
          environment,
        }
      );

      setResult(nextResult);
      if (!nextResult.ok) {
        setThreads((previous) =>
          previous.map((item) =>
            item.threadId === threadId ? { ...item, anchor: previousAnchor } : item
          )
        );
        return;
      }

      await refreshThreads();
    } catch (error) {
      setThreads((previous) =>
        previous.map((item) =>
          item.threadId === threadId ? { ...item, anchor: previousAnchor } : item
        )
      );
      setResult(toAnnotationErrorResult(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteThread(threadId: string, commitSha: string): Promise<void> {
    if (readOnly) {
      setResult({
        ok: false,
        message: "UNKNOWN_COMMIT: Cannot mutate annotations while commit SHA is unknown.",
      });
      return;
    }

    const deleteHandler = handlers.deleteThread;
    if (!deleteHandler) {
      setResult({ ok: false, message: "PROVIDER_ERROR: No deleteThread handler configured." });
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const nextResult = await deleteHandler(
        {
          threadId,
          pageKey,
          commitSha,
        },
        {
          host,
          pageKey,
          commitSha,
          projectId,
          environment,
        }
      );

      setResult(nextResult);
      if (!nextResult.ok) {
        return;
      }

      setThreads((previous) => previous.filter((item) => item.threadId !== threadId));
      await refreshThreads();
    } catch (error) {
      setResult(toAnnotationErrorResult(error));
    } finally {
      setSubmitting(false);
    }
  }

  const contextValue: AnnotationContextValue = {
    enabled: annotationEnabled,
    readOnly,
    triggerKey,
    pluginId: handlers.pluginId,
    pageKey,
    currentCommitSha,
    loading,
    submitting,
    result,
    threads,
    currentThreads: groupedThreads.current,
    staleThreads: groupedThreads.stale,
    showStale,
    draft,
    threadPositions,
    refreshThreads,
    setShowStale,
    setDraftBody: (value) => {
      setDraft((previous) => (previous ? { ...previous, body: value } : previous));
      setResult(null);
    },
    submitDraft,
    cancelDraft: () => {
      setDraft(null);
      setResult(null);
    },
    replyToThread,
    resolveThread,
    reopenThread,
    moveThreadAnchor,
    deleteThread,
  };

  return (
    <AnnotationProvider value={contextValue}>
      <AnnotationBubbles />
      <AnnotationPanel width={width} />
    </AnnotationProvider>
  );
}
