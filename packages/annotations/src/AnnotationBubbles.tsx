"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { AnnotationMessage, AnnotationPoint, AnnotationThread } from "./annotation-plugin";
import {
  formatLinkedElementLabel,
  resolveAnchorLinkedElement,
  resolveLinkedElementCenter,
} from "./anchor";
import { useAnnotationContext } from "./annotation-context";

type DragState = {
  threadId: string;
  startPointerX: number;
  startPointerY: number;
  startLeft: number;
  startTop: number;
  left: number;
  top: number;
  moved: boolean;
  dropPoint: AnnotationPoint;
  linkedCenter: AnnotationPoint | null;
};

export default function AnnotationBubbles() {
  const {
    enabled,
    readOnly,
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
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const [hoverHighlightRect, setHoverHighlightRect] = useState<AnnotationPoint & { width: number; height: number } | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  const visibleThreads = useMemo<AnnotationThread[]>(
    () => (showStale ? [...currentThreads, ...staleThreads] : currentThreads),
    [currentThreads, showStale, staleThreads]
  );

  useEffect(() => {
    if (!hoveredThreadId) {
      setHoverHighlightRect(null);
      return;
    }

    let frame = 0;

    const update = () => {
      const thread = visibleThreads.find((item) => item.threadId === hoveredThreadId);
      if (!thread) {
        setHoverHighlightRect(null);
        return;
      }

      const linked = resolveAnchorLinkedElement(thread.anchor);
      if (!linked) {
        setHoverHighlightRect(null);
        return;
      }

      const rect = linked.getBoundingClientRect();
      setHoverHighlightRect({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
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
  }, [hoveredThreadId, visibleThreads]);

  if (!enabled) {
    return null;
  }

  return (
    <>
      {hoverHighlightRect ? (
        <div
          data-deshlo-annotation-ui="1"
          style={{
            position: "fixed",
            left: hoverHighlightRect.x - 2,
            top: hoverHighlightRect.y - 2,
            width: hoverHighlightRect.width + 4,
            height: hoverHighlightRect.height + 4,
            border: "2px solid #0ea5e9",
            borderRadius: 6,
            boxShadow: "0 0 0 2px rgba(14, 165, 233, 0.25)",
            background: "rgba(14, 165, 233, 0.08)",
            pointerEvents: "none",
            zIndex: 9996,
          }}
        />
      ) : null}

      {dragState?.linkedCenter ? (
        <svg
          data-deshlo-annotation-ui="1"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          <line
            x1={dragState.left + 12}
            y1={dragState.top + 12}
            x2={dragState.linkedCenter.x}
            y2={dragState.linkedCenter.y}
            stroke="rgba(15, 23, 42, 0.45)"
            strokeWidth={4}
          />
          <line
            x1={dragState.left + 12}
            y1={dragState.top + 12}
            x2={dragState.linkedCenter.x}
            y2={dragState.linkedCenter.y}
            stroke="#0ea5e9"
            strokeWidth={2.5}
            strokeDasharray="7 4"
          />
          <circle
            cx={dragState.left + 12}
            cy={dragState.top + 12}
            r={4}
            fill="#ffffff"
            stroke="#0ea5e9"
            strokeWidth={2}
          />
          <circle
            cx={dragState.linkedCenter.x}
            cy={dragState.linkedCenter.y}
            r={4}
            fill="#ffffff"
            stroke="#0ea5e9"
            strokeWidth={2}
          />
        </svg>
      ) : null}

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
            <div style={{ opacity: 0.8, marginBottom: 8 }}>
              Linked to: <code>{formatLinkedElementLabel(draft.anchor)}</code>
            </div>
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
        const bubbleLeft = isDragging ? dragState.left : position.left;
        const bubbleTop = isDragging ? dragState.top : position.top;

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
            <button
              onPointerDown={(event) => {
                if (event.button !== 0) {
                  return;
                }

                event.preventDefault();
                event.stopPropagation();

                const start: DragState = {
                  threadId: thread.threadId,
                  startPointerX: event.clientX,
                  startPointerY: event.clientY,
                  startLeft: position.left,
                  startTop: position.top,
                  left: position.left,
                  top: position.top,
                  moved: false,
                  dropPoint: { x: event.clientX, y: event.clientY },
                  linkedCenter:
                    resolveLinkedElementCenter(thread.anchor) || {
                      x: thread.anchor.targetPoint.x,
                      y: thread.anchor.targetPoint.y,
                    },
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
                  const nextLeft = current.startLeft + dx;
                  const nextTop = current.startTop + dy;
                  const dropPoint = { x: moveEvent.clientX, y: moveEvent.clientY };
                  const linkedCenter = current.linkedCenter;

                  const next: DragState = {
                    ...current,
                    left: nextLeft,
                    top: nextTop,
                    moved,
                    dropPoint,
                    linkedCenter,
                  };

                  dragStateRef.current = next;
                  setDragState(next);
                };

                const onPointerUp = (upEvent: PointerEvent) => {
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

                  void moveThreadAnchor(thread.threadId, {
                    x: upEvent.clientX,
                    y: upEvent.clientY,
                  });
                };

                window.addEventListener("pointermove", onPointerMove, true);
                window.addEventListener("pointerup", onPointerUp, true);
                window.addEventListener("pointercancel", onPointerUp, true);
              }}
              style={{
                width: 24,
                height: 24,
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
                <div style={{ marginBottom: 6, opacity: 0.85 }}>
                  Linked to: <code>{formatLinkedElementLabel(thread.anchor)}</code>
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
