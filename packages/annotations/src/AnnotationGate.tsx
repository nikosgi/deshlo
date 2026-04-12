"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildAnnotationPageKey,
  toAnnotationErrorResult,
  type AnnotationActionResult,
  type AnnotationAnchor,
  type AnnotationCreateThreadHandler,
  type AnnotationDeleteThreadHandler,
  type AnnotationListCommitHistoryHandler,
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

const DEFAULT_TRIGGER_KEY: AnnotationTriggerKey = "alt";
const DEFAULT_COMMIT_ATTRIBUTE_NAME = "data-deshlo-commit";
const DEFAULT_COMMIT_META_NAME = "deshlo:commit";
const DEFAULT_COMMIT_WINDOW_KEY = "__DESHLO_COMMIT_SHA__";
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

function resolveInitialIdentity(preferredCommitSha?: string): RuntimeIdentity {
  const normalizedCommitSha = normalizeCommitSha(preferredCommitSha);
  return {
    ...UNKNOWN_IDENTITY,
    commitSha: normalizedCommitSha || UNKNOWN_IDENTITY.commitSha,
  };
}

function isTriggerPressed(
  event: Pick<MouseEvent, "altKey" | "shiftKey" | "metaKey" | "ctrlKey">,
  triggerKey: AnnotationTriggerKey
): boolean {
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

function normalizeCommitSha(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized === "unknown") {
    return null;
  }

  return normalized;
}

function resolveCurrentCommitSha(preferredCommitSha?: string): string {
  const configuredCommitSha = normalizeCommitSha(preferredCommitSha);
  if (configuredCommitSha) {
    return configuredCommitSha;
  }

  if (typeof window !== "undefined") {
    const globalCommitSha = normalizeCommitSha(
      (window as Window & { [DEFAULT_COMMIT_WINDOW_KEY]?: string })[DEFAULT_COMMIT_WINDOW_KEY]
    );
    if (globalCommitSha) {
      return globalCommitSha;
    }
  }

  if (typeof document === "undefined") {
    return "unknown";
  }

  const domCommitCandidates = [
    document.documentElement.getAttribute(DEFAULT_COMMIT_ATTRIBUTE_NAME),
    document.body?.getAttribute(DEFAULT_COMMIT_ATTRIBUTE_NAME),
    document
      .querySelector(`meta[name='${DEFAULT_COMMIT_META_NAME}']`)
      ?.getAttribute("content"),
  ];

  for (const candidate of domCommitCandidates) {
    const commitSha = normalizeCommitSha(candidate);
    if (commitSha) {
      return commitSha;
    }
  }

  return "unknown";
}

function resolveRuntimeIdentity(preferredCommitSha?: string): RuntimeIdentity {
  if (typeof window === "undefined") {
    return {
      ...UNKNOWN_IDENTITY,
      commitSha: resolveCurrentCommitSha(preferredCommitSha),
    };
  }

  return {
    pageKey: buildAnnotationPageKey(window.location),
    host: window.location.host,
    commitSha: resolveCurrentCommitSha(preferredCommitSha),
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
  commitSha?: string;
  onListThreads?: AnnotationListThreadsHandler;
  onListCommitHistory?: AnnotationListCommitHistoryHandler;
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
  commitSha,
  githubToken,
  githubHostConfig,
  githubBranch,
  githubBranchesLimit,
  onListThreads,
  onListCommitHistory,
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
    onListCommitHistory,
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
  const [previewHighlightRect, setPreviewHighlightRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [threadPositions, setThreadPositions] = useState<AnnotationContextValue["threadPositions"]>({});
  const pointerPointRef = useRef<AnnotationPoint | null>(null);
  // Keep first render deterministic for SSR hydration; resolve real runtime identity after mount.
  const [identity, setIdentity] = useState<RuntimeIdentity>(() => resolveInitialIdentity(commitSha));
  const [selectedCommitSha, setSelectedCommitSha] = useState<string>(
    resolveInitialIdentity(commitSha).commitSha
  );

  const pageKey = identity.pageKey;
  const host = identity.host;
  const currentCommitSha = identity.commitSha;
  const readOnly = !isKnownCommitSha(currentCommitSha);

  const groupedThreads = useMemo(
    () => groupThreadsByRevision(threads, selectedCommitSha),
    [threads, selectedCommitSha]
  );

  useEffect(() => {
    setSelectedCommitSha(currentCommitSha);
  }, [currentCommitSha, pageKey]);

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
        setIdentity(resolveRuntimeIdentity(commitSha));
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
  }, [annotationEnabled, handlers.pluginId, pageKey, currentCommitSha, commitSha]);

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
      setPreviewHighlightRect(null);
      return;
    }

    let frame = 0;
    let triggerActive = false;

    const clearPreview = () => {
      setPreviewHighlightRect(null);
    };

    const recompute = () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }

      frame = requestAnimationFrame(() => {
        if (!triggerActive || !pointerPointRef.current) {
          clearPreview();
          return;
        }

        const deepestTarget = resolveDeepestTargetAtPoint(pointerPointRef.current);
        if (!deepestTarget) {
          clearPreview();
          return;
        }

        const rect = deepestTarget.getBoundingClientRect();
        setPreviewHighlightRect({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });
      });
    };

    const onMouseMove = (event: MouseEvent) => {
      pointerPointRef.current = toPointFromMouseEvent(event);
      triggerActive = isTriggerPressed(event, triggerKey);
      if (!triggerActive) {
        clearPreview();
        return;
      }
      recompute();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      triggerActive = isTriggerPressed(event, triggerKey);
      if (triggerActive) {
        recompute();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      triggerActive = isTriggerPressed(event, triggerKey);
      if (!triggerActive) {
        clearPreview();
        return;
      }
      recompute();
    };

    const onViewportChange = () => {
      if (!triggerActive) {
        return;
      }
      recompute();
    };

    const onBlur = () => {
      triggerActive = false;
      clearPreview();
    };

    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("blur", onBlur);

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [annotationEnabled, triggerKey]);

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
      setPreviewHighlightRect(null);
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

  async function moveThreadAnchor(
    threadId: string,
    input: {
      point: AnnotationPoint;
      anchor?: AnnotationAnchor;
    }
  ): Promise<void> {
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

    let nextAnchor: AnnotationAnchor | null = input.anchor ?? null;
    if (!nextAnchor) {
      const deepestTarget = resolveDeepestTargetAtPoint(input.point);
      if (!deepestTarget) {
        setResult({ ok: false, message: "TARGET_NOT_FOUND: Could not resolve drop target element." });
        return;
      }
      nextAnchor = captureAnnotationAnchor(deepestTarget, input.point);
    }

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
    selectedCommitSha,
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
    setSelectedCommitSha: (value) => {
      const normalized = value.trim();
      setSelectedCommitSha(normalized || currentCommitSha);
    },
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
    <>
      {previewHighlightRect ? (
        <div
          data-deshlo-annotation-ui="1"
          style={{
            position: "fixed",
            left: previewHighlightRect.x - 2,
            top: previewHighlightRect.y - 2,
            width: previewHighlightRect.width + 4,
            height: previewHighlightRect.height + 4,
            border: "2px solid #0ea5e9",
            borderRadius: 6,
            boxShadow: "0 0 0 2px rgba(14, 165, 233, 0.25)",
            background: "rgba(14, 165, 233, 0.08)",
            pointerEvents: "none",
            zIndex: 9996,
          }}
        />
      ) : null}
      <AnnotationProvider value={contextValue}>
        <AnnotationBubbles />
        <AnnotationPanel
          width={width}
          githubToken={githubToken}
          githubHostConfig={githubHostConfig}
          githubBranch={githubBranch}
          githubBranchesLimit={githubBranchesLimit}
          listCommitHistory={handlers.listCommitHistory}
        />
      </AnnotationProvider>
    </>
  );
}
