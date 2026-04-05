"use client";

import { useMemo } from "react";

import type { AnnotationResultLink } from "./annotation-plugin";
import { useAnnotationContext } from "./annotation-context";

export interface AnnotationPanelProps {
  width?: number;
}

export default function AnnotationPanel({ width = 420 }: AnnotationPanelProps) {
  const {
    enabled,
    readOnly,
    triggerKey,
    pluginId,
    pageKey,
    currentCommitSha,
    loading,
    result,
    currentThreads,
    staleThreads,
    showStale,
    setShowStale,
    refreshThreads,
  } = useAnnotationContext();

  const commitHistory = useMemo(() => {
    const byCommit = new Map<
      string,
      { commitSha: string; threads: number; comments: number; latestUpdatedAt: string }
    >();

    for (const thread of [...currentThreads, ...staleThreads]) {
      const existing = byCommit.get(thread.commitSha);
      const comments = thread.messages.length;
      const updatedAt = thread.updatedAt || thread.createdAt || "";
      if (!existing) {
        byCommit.set(thread.commitSha, {
          commitSha: thread.commitSha,
          threads: 1,
          comments,
          latestUpdatedAt: updatedAt,
        });
        continue;
      }

      existing.threads += 1;
      existing.comments += comments;
      if (updatedAt && (!existing.latestUpdatedAt || updatedAt > existing.latestUpdatedAt)) {
        existing.latestUpdatedAt = updatedAt;
      }
    }

    return Array.from(byCommit.values()).sort((left, right) =>
      right.latestUpdatedAt.localeCompare(left.latestUpdatedAt)
    );
  }, [currentThreads, staleThreads]);

  if (!enabled) {
    return null;
  }

  return (
    <div
      data-deshlo-annotation-ui="1"
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 10000,
        width,
        maxHeight: "80vh",
        overflowY: "auto",
        padding: 12,
        borderRadius: 10,
        border: "1px solid #0ea5e9",
        background: "rgba(17, 17, 17, 0.96)",
        color: "#f8fafc",
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Live Annotations</div>
      <div style={{ marginBottom: 8 }}>
        Hold {triggerKey.toUpperCase()} + click anywhere to create an annotation.
      </div>
      <div style={{ marginBottom: 8 }}>
        Plugin: <code>{pluginId}</code>
      </div>
      <div style={{ marginBottom: 8 }}>
        Page: <code>{pageKey}</code>
      </div>
      <div style={{ marginBottom: 8 }}>
        Commit: <code>{currentCommitSha}</code>
      </div>

      {readOnly ? (
        <div style={{ marginBottom: 8, color: "#fca5a5" }}>
          Read-only mode: current commit SHA is unknown, so creating new annotations is disabled.
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button
          onClick={() => {
            void refreshThreads();
          }}
          disabled={loading}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #334155",
            background: "transparent",
            color: "#f8fafc",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={showStale}
            onChange={(event) => {
              setShowStale(event.target.checked);
            }}
          />
          Show stale
        </label>
      </div>

      <div style={{ marginBottom: 8 }}>
        Current: <code>{currentThreads.length}</code> | Stale: <code>{staleThreads.length}</code>
      </div>
      <div style={{ opacity: 0.8, marginBottom: 8 }}>
        Thread actions are available directly on bubbles.
      </div>

      <div style={{ borderTop: "1px solid #334155", marginTop: 10, paddingTop: 8 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Commit History</div>
        {commitHistory.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No commit history yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {commitHistory.map((entry) => (
              <div
                key={entry.commitSha}
                style={{
                  border: "1px solid #334155",
                  borderRadius: 8,
                  padding: 8,
                  background: "rgba(15, 23, 42, 0.5)",
                }}
              >
                <div style={{ marginBottom: 4 }}>
                  <code>{entry.commitSha.slice(0, 12)}</code>
                  {entry.commitSha === currentCommitSha ? (
                    <span style={{ marginLeft: 6, color: "#38bdf8" }}>(current)</span>
                  ) : null}
                </div>
                <div style={{ opacity: 0.85 }}>
                  Threads: <code>{entry.threads}</code> | Comments: <code>{entry.comments}</code>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {result ? (
        <div
          style={{
            borderTop: "1px solid #334155",
            marginTop: 10,
            paddingTop: 8,
            color: result.ok ? "#86efac" : "#fca5a5",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{result.ok ? "Success" : "Error"}</div>
          <div>{result.message}</div>
          {result.links && result.links.length > 0 ? (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              {result.links.map((link: AnnotationResultLink) => (
                <a
                  key={`${link.label}-${link.url}`}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#93c5fd" }}
                >
                  {link.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
