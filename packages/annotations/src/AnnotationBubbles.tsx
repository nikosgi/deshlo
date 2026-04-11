"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AnnotationAnchor,
  AnnotationMessage,
  AnnotationPoint,
  AnnotationThread,
  AnnotationTriggerKey,
} from "./annotation-plugin";
import {
  BUBBLE_RADIUS,
  BUBBLE_SIZE,
  captureAnnotationAnchor,
  resolveAnnotationPosition,
  resolveAnchorLinkedElement,
  resolveAnchorTargetPoint,
  resolveDeepestTargetAtPoint,
} from "./anchor";
import { useAnnotationContext } from "./annotation-context";

type HighlightRect = AnnotationPoint & { width: number; height: number };

type DragState = {
  threadId: string;
  startPointerX: number;
  startPointerY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  left: number;
  top: number;
  moved: boolean;
  dropPoint: AnnotationPoint;
  pendingAnchor: AnnotationAnchor;
  linkedCenter: AnnotationPoint | null;
  linkedRect: HighlightRect | null;
  detached: boolean;
  detachAnchor: AnnotationAnchor | null;
  detachOriginCenter: AnnotationPoint | null;
  detachBaseLeft: number;
  detachBaseTop: number;
};

type DropOverride = {
  left: number;
  top: number;
  setAt: number;
};

function isTriggerPressed(
  event: Pick<PointerEvent, "altKey" | "shiftKey" | "metaKey" | "ctrlKey">,
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

function resolveConnectorStartPoint(
  bubbleLeft: number,
  bubbleTop: number,
  target: AnnotationPoint
): AnnotationPoint {
  const centerX = bubbleLeft + BUBBLE_RADIUS;
  const centerY = bubbleTop + BUBBLE_RADIUS;
  const dx = target.x - centerX;
  const dy = target.y - centerY;
  const distance = Math.hypot(dx, dy);

  if (distance <= 0.001) {
    return { x: centerX, y: centerY };
  }

  const ratio = BUBBLE_RADIUS / distance;
  return {
    x: centerX + dx * ratio,
    y: centerY + dy * ratio,
  };
}

export default function AnnotationBubbles() {
  const {
    enabled,
    readOnly,
    triggerKey,
    submitting,
    draft,
    setDraftBody,
    submitDraft,
    cancelDraft,
    currentThreads,
    staleThreads,
    showStale,
    threadPositions,
    replyToThread,
    resolveThread,
    reopenThread,
    moveThreadAnchor,
    deleteThread,
  } = useAnnotationContext();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropOverrides, setDropOverrides] = useState<Record<string, DropOverride>>({});
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const dragStateRef = useRef<DragState | null>(null);

  const visibleThreads = useMemo<AnnotationThread[]>(
    () => (showStale ? [...currentThreads, ...staleThreads] : currentThreads),
    [currentThreads, showStale, staleThreads]
  );

  useEffect(() => {
    let frame = 0;

    const update = () => {
      if (dragState?.linkedRect) {
        setHighlightRects([dragState.linkedRect]);
        return;
      }

      const threadIds = new Set<string>();
      if (hoveredThreadId) {
        threadIds.add(hoveredThreadId);
      }

      for (const [threadId, isExpanded] of Object.entries(expanded)) {
        if (isExpanded) {
          threadIds.add(threadId);
        }
      }

      if (threadIds.size === 0) {
        setHighlightRects([]);
        return;
      }

      const threadById = new Map(visibleThreads.map((thread) => [thread.threadId, thread]));
      const nextRects: HighlightRect[] = [];

      for (const threadId of threadIds) {
        const thread = threadById.get(threadId);
        if (!thread) {
          continue;
        }

        const linked = resolveAnchorLinkedElement(thread.anchor);
        if (!linked) {
          continue;
        }

        const rect = linked.getBoundingClientRect();
        nextRects.push({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });
      }

      setHighlightRects(nextRects);
    };

    const requestUpdate = () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(update);
    };

    requestUpdate();
    window.addEventListener("resize", requestUpdate);
    window.addEventListener("scroll", requestUpdate, true);

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      window.removeEventListener("resize", requestUpdate);
      window.removeEventListener("scroll", requestUpdate, true);
    };
  }, [dragState?.linkedRect, expanded, hoveredThreadId, visibleThreads]);

  useEffect(() => {
    if (Object.keys(dropOverrides).length === 0) {
      return;
    }

    const now = Date.now();
    const nextOverrides: Record<string, DropOverride> = {};

    for (const [threadId, override] of Object.entries(dropOverrides)) {
      const position = threadPositions[threadId];
      if (!position || !position.anchored) {
        continue;
      }

      const closeEnough =
        Math.abs(position.left - override.left) <= 1 &&
        Math.abs(position.top - override.top) <= 1;
      const expired = now - override.setAt > 2000;

      if (!closeEnough && !expired) {
        nextOverrides[threadId] = override;
      }
    }

    if (Object.keys(nextOverrides).length !== Object.keys(dropOverrides).length) {
      setDropOverrides(nextOverrides);
    }
  }, [dropOverrides, threadPositions]);

  if (!enabled) {
    return null;
  }

  return (
    <>
      {highlightRects.map((highlightRect, index) => (
        <div
          key={`${index}-${highlightRect.x}-${highlightRect.y}-${highlightRect.width}-${highlightRect.height}`}
          data-deshlo-annotation-ui="1"
          style={{
            position: "fixed",
            left: highlightRect.x - 2,
            top: highlightRect.y - 2,
            width: highlightRect.width + 4,
            height: highlightRect.height + 4,
            border: "2px solid red",
            borderRadius: 6,
            boxShadow: "0 0 0 2px rgba(14, 165, 233, 0.25)",
            background: "rgba(14, 165, 233, 0.08)",
            pointerEvents: "none",
            zIndex: 9996,
          }}
        />
      ))}

      {dragState?.moved && dragState.detached && dragState.detachOriginCenter ? (() => {
        const start = resolveConnectorStartPoint(
          dragState.left,
          dragState.top,
          dragState.detachOriginCenter
        );
        return (
          <svg
            data-deshlo-annotation-ui="1"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9997,
              pointerEvents: "none",
              overflow: "visible",
            }}
          >
            <line
              x1={start.x}
              y1={start.y}
              x2={dragState.detachOriginCenter.x}
              y2={dragState.detachOriginCenter.y}
              stroke="transparent"
              strokeWidth={4}
            />
            <line
              x1={start.x}
              y1={start.y}
              x2={dragState.detachOriginCenter.x}
              y2={dragState.detachOriginCenter.y}
              stroke="#0ea5e9"
              strokeWidth={2.5}
              strokeDasharray="7 4"
            />
            <circle
              cx={dragState.detachOriginCenter.x}
              cy={dragState.detachOriginCenter.y}
              r={4}
              fill="#ffffff"
              stroke="#0ea5e9"
              strokeWidth={2}
            />
          </svg>
        );
      })() : null}

      {draft ? (
        <div
          data-deshlo-annotation-ui="1"
          style={{
            position: "fixed",
            left: draft.left,
            top: draft.top,
            zIndex: 9999,
          }}
        >
          <div
            data-deshlo-annotation-ui="1"
            style={{
              width: 300,
              borderRadius: 10,
              border: "1px solid #0ea5e9",
              background: "rgba(17, 17, 17, 0.96)",
              color: "#f8fafc",
              padding: 10,
              boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>New Annotation</div>
            <textarea
              value={draft.body}
              rows={4}
              onChange={(event) => {
                setDraftBody(event.target.value);
              }}
              placeholder={readOnly ? "Read-only mode" : "Describe the issue..."}
              style={{
                width: "100%",
                resize: "vertical",
                padding: 8,
                borderRadius: 6,
                border: "1px solid #334155",
                fontFamily: "inherit",
                fontSize: 12,
                marginBottom: 8,
              }}
              disabled={readOnly || submitting}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  void submitDraft();
                }}
                disabled={readOnly || submitting || !draft.body.trim()}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #22c55e",
                  background: readOnly || submitting || !draft.body.trim() ? "#475569" : "#22c55e",
                  color: "#111827",
                  cursor: readOnly || submitting || !draft.body.trim() ? "not-allowed" : "pointer",
                  fontWeight: 600,
                }}
              >
                {submitting ? "Saving..." : "Create thread"}
              </button>
              <button
                onClick={cancelDraft}
                disabled={submitting}
                style={{
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  background: "transparent",
                  color: "#f8fafc",
                  cursor: submitting ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {visibleThreads.map((thread) => {
        const position = threadPositions[thread.threadId];
        if (!position || !position.anchored) {
          return null;
        }

        const isExpanded = Boolean(expanded[thread.threadId]);
        const replyBody = replyDrafts[thread.threadId] ?? "";
        const isDragging = dragState?.threadId === thread.threadId;
        const dropOverride = dropOverrides[thread.threadId];
        const bubbleLeft = isDragging ? dragState.left : dropOverride?.left ?? position.left;
        const bubbleTop = isDragging ? dragState.top : dropOverride?.top ?? position.top;
        const isHovered = hoveredThreadId === thread.threadId;
        const persistedLinkedCenter = !isDragging ? resolveAnchorTargetPoint(thread.anchor) : null;
        const showPersistedLine =
          !isDragging &&
          thread.anchor.presentation?.mode === "detached" &&
          (isHovered || isExpanded) &&
          Boolean(persistedLinkedCenter);

        return (
          <div
            key={thread.threadId}
            data-deshlo-annotation-ui="1"
            onMouseEnter={() => {
              setHoveredThreadId(thread.threadId);
            }}
            onMouseLeave={() => {
              setHoveredThreadId((previous) =>
                previous === thread.threadId ? null : previous
              );
            }}
            style={{
              position: "fixed",
              left: bubbleLeft,
              top: bubbleTop,
              zIndex: 9998,
            }}
          >
            {showPersistedLine && persistedLinkedCenter
              ? (() => {
                  const start = resolveConnectorStartPoint(
                    bubbleLeft,
                    bubbleTop,
                    persistedLinkedCenter
                  );
                  return (
                    <svg
                      data-deshlo-annotation-ui="1"
                      style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 9997,
                        pointerEvents: "none",
                        overflow: "visible",
                      }}
                    >
                      <line
                        x1={start.x}
                        y1={start.y}
                        x2={persistedLinkedCenter.x}
                        y2={persistedLinkedCenter.y}
                        stroke="transparent"
                        strokeWidth={3}
                      />
                      <line
                        x1={start.x}
                        y1={start.y}
                        x2={persistedLinkedCenter.x}
                        y2={persistedLinkedCenter.y}
                        stroke="#0ea5e9"
                        strokeWidth={2}
                        strokeDasharray="6 5"
                      />
                    </svg>
                  );
                })()
              : null}
            <button
              onPointerDown={(event) => {
                if (event.button !== 0) {
                  return;
                }

                event.preventDefault();
                event.stopPropagation();
                setHoveredThreadId(null);
                setDropOverrides((previous) => {
                  if (!previous[thread.threadId]) {
                    return previous;
                  }
                  const next = { ...previous };
                  delete next[thread.threadId];
                  return next;
                });

                const initialLinkedElement = resolveAnchorLinkedElement(thread.anchor);
                const initialLinkedRect = initialLinkedElement?.getBoundingClientRect();
                const initialBubbleCenter = {
                  x: position.left + BUBBLE_RADIUS,
                  y: position.top + BUBBLE_RADIUS,
                };
                const initialDetachAnchor = thread.anchor;
                const initialDetachOriginCenter =
                  resolveAnchorTargetPoint(thread.anchor) || initialBubbleCenter;
                const initialBaseAnchor: AnnotationAnchor = {
                  ...initialDetachAnchor,
                  presentation: {
                    mode: "attached",
                  },
                };
                const initialBasePosition = resolveAnnotationPosition(initialBaseAnchor);

                const start: DragState = {
                  threadId: thread.threadId,
                  startPointerX: event.clientX,
                  startPointerY: event.clientY,
                  pointerOffsetX: event.clientX - position.left,
                  pointerOffsetY: event.clientY - position.top,
                  left: position.left,
                  top: position.top,
                  moved: false,
                  dropPoint: initialBubbleCenter,
                  pendingAnchor: thread.anchor,
                  linkedCenter:
                    initialLinkedRect
                      ? {
                          x: initialLinkedRect.left + initialLinkedRect.width / 2,
                          y: initialLinkedRect.top + initialLinkedRect.height / 2,
                        }
                      : resolveAnchorTargetPoint(thread.anchor) || {
                          x: thread.anchor.targetPoint.x,
                          y: thread.anchor.targetPoint.y,
                        },
                  linkedRect: initialLinkedRect
                    ? {
                        x: initialLinkedRect.left,
                        y: initialLinkedRect.top,
                        width: initialLinkedRect.width,
                        height: initialLinkedRect.height,
                      }
                    : null,
                  detached: true,
                  detachAnchor: initialDetachAnchor,
                  detachOriginCenter: initialDetachOriginCenter,
                  detachBaseLeft: initialBasePosition.left,
                  detachBaseTop: initialBasePosition.top,
                };
                dragStateRef.current = start;
                setDragState(start);

                const onPointerMove = (moveEvent: PointerEvent) => {
                  const current = dragStateRef.current;
                  if (!current) {
                    return;
                  }

                  const dx = moveEvent.clientX - current.startPointerX;
                  const dy = moveEvent.clientY - current.startPointerY;
                  const moved = current.moved || Math.abs(dx) > 3 || Math.abs(dy) > 3;
                  const draggedLeft = moveEvent.clientX - current.pointerOffsetX;
                  const draggedTop = moveEvent.clientY - current.pointerOffsetY;
                  const dropPoint = {
                    x: draggedLeft + BUBBLE_RADIUS,
                    y: draggedTop + BUBBLE_RADIUS,
                  };
                  const attached = isTriggerPressed(moveEvent, triggerKey);
                  const detached = !attached;
                  const enteredDetach = detached && !current.detached;

                  let nextLeft = draggedLeft;
                  let nextTop = draggedTop;
                  let pendingAnchor = current.pendingAnchor;
                  let linkedCenter = current.linkedCenter;
                  let linkedRect = current.linkedRect;
                  let detachAnchor = current.detachAnchor;
                  let detachOriginCenter = current.detachOriginCenter;
                  let detachBaseLeft = current.detachBaseLeft;
                  let detachBaseTop = current.detachBaseTop;

                  if (enteredDetach) {
                    const lockedAnchor = current.pendingAnchor;
                    const lockedBaseAnchor: AnnotationAnchor = {
                      ...lockedAnchor,
                      presentation: {
                        mode: "attached",
                      },
                    };
                    const lockedBasePosition = resolveAnnotationPosition(lockedBaseAnchor);

                    detachAnchor = lockedAnchor;
                    detachOriginCenter = resolveAnchorTargetPoint(lockedAnchor) || {
                        x: current.left + BUBBLE_RADIUS,
                        y: current.top + BUBBLE_RADIUS,
                      };
                    detachBaseLeft = lockedBasePosition.left;
                    detachBaseTop = lockedBasePosition.top;
                  }

                  if (attached) {
                    const deepestTarget = resolveDeepestTargetAtPoint(dropPoint);
                    if (deepestTarget) {
                      const targetRect = deepestTarget.getBoundingClientRect();
                      const capturedAnchor = captureAnnotationAnchor(deepestTarget, dropPoint);
                      const attachedAnchor: AnnotationAnchor = {
                        ...capturedAnchor,
                        presentation: {
                          mode: "attached",
                        },
                      };
                      const attachedPosition = resolveAnnotationPosition(attachedAnchor);

                      linkedCenter = {
                        x: targetRect.left + targetRect.width / 2,
                        y: targetRect.top + targetRect.height / 2,
                      };
                      linkedRect = {
                        x: targetRect.left,
                        y: targetRect.top,
                        width: targetRect.width,
                        height: targetRect.height,
                      };

                      nextLeft = attachedPosition.left;
                      nextTop = attachedPosition.top;
                      pendingAnchor = attachedAnchor;
                    }
                  } else {
                    const lockAnchor = detachAnchor || current.pendingAnchor;
                    nextLeft = draggedLeft;
                    nextTop = draggedTop;
                    pendingAnchor = {
                      ...lockAnchor,
                      presentation: {
                        mode: "detached",
                        offsetX: draggedLeft - detachBaseLeft,
                        offsetY: draggedTop - detachBaseTop,
                      },
                    };

                    linkedCenter =
                      detachOriginCenter || resolveAnchorTargetPoint(lockAnchor) || linkedCenter;
                    const lockedTarget = resolveAnchorLinkedElement(lockAnchor);
                    if (lockedTarget) {
                      const lockedRect = lockedTarget.getBoundingClientRect();
                      linkedRect = {
                        x: lockedRect.left,
                        y: lockedRect.top,
                        width: lockedRect.width,
                        height: lockedRect.height,
                      };
                    }
                  }

                  const next: DragState = {
                    ...current,
                    left: nextLeft,
                    top: nextTop,
                    moved,
                    dropPoint,
                    pendingAnchor,
                    linkedCenter,
                    linkedRect,
                    detached,
                    detachAnchor,
                    detachOriginCenter,
                    detachBaseLeft,
                    detachBaseTop,
                  };

                  dragStateRef.current = next;
                  setDragState(next);
                };

                const onPointerUp = () => {
                  window.removeEventListener("pointermove", onPointerMove, true);
                  window.removeEventListener("pointerup", onPointerUp, true);
                  window.removeEventListener("pointercancel", onPointerUp, true);

                  const current = dragStateRef.current;
                  dragStateRef.current = null;
                  setDragState(null);

                  if (!current || current.threadId !== thread.threadId) {
                    return;
                  }

                  if (!current.moved) {
                    setExpanded((previous) => ({
                      ...previous,
                      [thread.threadId]: !previous[thread.threadId],
                    }));
                    return;
                  }

                  setDropOverrides((previous) => ({
                    ...previous,
                    [thread.threadId]: {
                      left: current.left,
                      top: current.top,
                      setAt: Date.now(),
                    },
                  }));

                  void moveThreadAnchor(thread.threadId, {
                    point: current.dropPoint,
                    anchor: current.pendingAnchor,
                  });
                };

                window.addEventListener("pointermove", onPointerMove, true);
                window.addEventListener("pointerup", onPointerUp, true);
                window.addEventListener("pointercancel", onPointerUp, true);
              }}
              style={{
                width: BUBBLE_SIZE,
                height: BUBBLE_SIZE,
                borderRadius: "999px",
                border: "1px solid #0ea5e9",
                background: thread.status === "resolved" ? "#1e293b" : "#0ea5e9",
                color: "#111827",
                fontWeight: 700,
                fontSize: 12,
                cursor: "grab",
              }}
              title={thread.threadId}
              data-deshlo-annotation-ui="1"
            >
              {thread.messages.length}
            </button>

            {isExpanded ? (
              <div
                data-deshlo-annotation-ui="1"
                style={{
                  position: "absolute",
                  top: 28,
                  right: 0,
                  width: 340,
                  borderRadius: 10,
                  border: "1px solid #0ea5e9",
                  background: "rgba(17, 17, 17, 0.96)",
                  color: "#f8fafc",
                  padding: 10,
                  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  Thread {thread.status.toUpperCase()}
                </div>
                <div style={{ maxHeight: 160, overflowY: "auto", marginBottom: 8 }}>
                  {thread.messages.map((message: AnnotationMessage) => (
                    <div key={message.messageId} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 11, opacity: 0.75 }}>
                        {message.author || "anonymous"} · {message.createdAt}
                      </div>
                      <div>{message.body}</div>
                    </div>
                  ))}
                </div>

                <textarea
                  value={replyBody}
                  rows={2}
                  onChange={(event) => {
                    setReplyDrafts((previous) => ({
                      ...previous,
                      [thread.threadId]: event.target.value,
                    }));
                  }}
                  placeholder="Reply"
                  style={{
                    width: "100%",
                    resize: "vertical",
                    padding: 8,
                    borderRadius: 6,
                    border: "1px solid #334155",
                    fontFamily: "inherit",
                    fontSize: 12,
                    marginBottom: 8,
                  }}
                  disabled={readOnly || submitting}
                />

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    disabled={readOnly || submitting || !replyBody.trim()}
                    onClick={() => {
                      void replyToThread(thread.threadId, replyBody.trim());
                      setReplyDrafts((previous) => ({
                        ...previous,
                        [thread.threadId]: "",
                      }));
                    }}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid #22c55e",
                      background: "transparent",
                      color: "#86efac",
                      cursor: readOnly || submitting || !replyBody.trim() ? "not-allowed" : "pointer",
                    }}
                  >
                    Reply
                  </button>

                  {thread.status === "open" ? (
                    <button
                      disabled={readOnly || submitting}
                      onClick={() => {
                        void resolveThread(thread.threadId, thread.commitSha);
                      }}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid #f59e0b",
                        background: "transparent",
                        color: "#fcd34d",
                        cursor: readOnly || submitting ? "not-allowed" : "pointer",
                      }}
                    >
                      Resolve
                    </button>
                  ) : (
                    <button
                      disabled={readOnly || submitting}
                      onClick={() => {
                        void reopenThread(thread.threadId, thread.commitSha);
                      }}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid #38bdf8",
                        background: "transparent",
                        color: "#7dd3fc",
                        cursor: readOnly || submitting ? "not-allowed" : "pointer",
                      }}
                    >
                      Reopen
                    </button>
                  )}

                  <button
                    disabled={readOnly || submitting}
                    onClick={() => {
                      if (!window.confirm("Delete this thread permanently?")) {
                        return;
                      }
                      void deleteThread(thread.threadId, thread.commitSha);
                    }}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid #ef4444",
                      background: "transparent",
                      color: "#fca5a5",
                      cursor: readOnly || submitting ? "not-allowed" : "pointer",
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
