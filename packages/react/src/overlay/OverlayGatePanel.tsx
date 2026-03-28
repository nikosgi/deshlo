"use client";

import { useSourceInspectorContext } from "./source-inspector-context";

export interface OverlayGatePanelProps {
  width?: number;
}

export default function OverlayGatePanel({ width = 420 }: OverlayGatePanelProps) {
  const {
    inspectorEnabled,
    triggerKey,
    pluginId,
    currentRevision,
    selection,
    selectionWarning,
    proposedText,
    submitting,
    result,
    changes,
    changesLoading,
    changesError,
    changesTab,
    setProposedText,
    submit,
    refreshChanges,
    setChangesTab,
  } = useSourceInspectorContext();

  if (!inspectorEnabled) {
    return null;
  }

  const canSubmit = Boolean(selection && proposedText.trim() && !submitting);
  const visibleChanges =
    changesTab === "all"
      ? changes
      : changes.filter((change) => change.baseCommitSha === currentRevision);

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 9999,
        width,
        maxHeight: "80vh",
        overflowY: "auto",
        padding: 12,
        borderRadius: 10,
        border: "1px solid #f59e0b",
        background: "rgba(17, 17, 17, 0.96)",
        color: "#f8fafc",
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Source Inspector</div>
      <div style={{ marginBottom: 8 }}>
        Hold {triggerKey.toUpperCase()} + click to select an element from source.
      </div>
      <div style={{ marginBottom: 8 }}>
        Plugin: <code>{pluginId}</code>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Selection</div>
        {selection ? (
          <>
            <div>
              Tag: <code>{selection.tagName}</code>
            </div>
            <div>
              Source: <code>{selection.sourceLoc}</code>
            </div>
            <div>
              Current text: <code>{selection.selectedText}</code>
            </div>
            <div>
              Commit: <code>{selection.commitSha || "unknown"}</code>
            </div>
          </>
        ) : (
          <div style={{ opacity: 0.85 }}>No valid element selected yet.</div>
        )}
      </div>

      {selectionWarning ? (
        <div style={{ marginBottom: 8, color: "#fca5a5" }}>{selectionWarning}</div>
      ) : null}

      {selection ? (
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>
            Proposed changes
          </label>
          <textarea
            value={proposedText}
            onChange={(event) => {
              setProposedText(event.target.value);
            }}
            rows={4}
            style={{
              width: "100%",
              resize: "vertical",
              padding: 8,
              borderRadius: 6,
              border: "1px solid #334155",
              fontFamily: "inherit",
              fontSize: 12,
            }}
          />
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button
          onClick={submit}
          disabled={!canSubmit}
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid #22c55e",
            background: canSubmit ? "#22c55e" : "#475569",
            color: "#111827",
            fontWeight: 600,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {submitting ? "Submitting..." : "Submit changes"}
        </button>
      </div>

      <div style={{ borderTop: "1px solid #334155", paddingTop: 8, marginBottom: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Proposed Changes</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <button
            onClick={() => {
              setChangesTab("current");
            }}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: changesTab === "current" ? "#1e293b" : "transparent",
              color: "#f8fafc",
              cursor: "pointer",
            }}
          >
            Current Revision
          </button>
          <button
            onClick={() => {
              setChangesTab("all");
            }}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: changesTab === "all" ? "#1e293b" : "transparent",
              color: "#f8fafc",
              cursor: "pointer",
            }}
          >
            All Open
          </button>
          <button
            onClick={() => {
              void refreshChanges();
            }}
            style={{
              marginLeft: "auto",
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: "transparent",
              color: "#f8fafc",
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>

        {changesLoading ? <div style={{ opacity: 0.85 }}>Loading proposed changes...</div> : null}
        {changesError ? <div style={{ color: "#fca5a5" }}>{changesError}</div> : null}

        {!changesLoading && !changesError ? (
          visibleChanges.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {visibleChanges.map((change) => (
                <div
                  key={`${change.prNumber}-${change.changeId}`}
                  style={{
                    border: "1px solid #334155",
                    borderRadius: 8,
                    padding: 8,
                    background: "rgba(15, 23, 42, 0.5)",
                  }}
                >
                  <div>
                    <strong>{change.tagName}</strong> at <code>{change.sourceLoc}</code>
                  </div>
                  <div>
                    Proposed: <code>{change.proposedText}</code>
                  </div>
                  <div>
                    PR:{" "}
                    <a
                      href={change.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#93c5fd" }}
                    >
                      #{change.prNumber}
                    </a>
                  </div>
                  <div style={{ opacity: 0.8 }}>
                    Updated: <code>{change.updatedAt}</code>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ opacity: 0.85 }}>No proposed changes found.</div>
          )
        ) : null}
      </div>

      {result ? (
        <div
          style={{
            borderTop: "1px solid #334155",
            paddingTop: 8,
            color: result.ok ? "#86efac" : "#fca5a5",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {result.ok ? "Success" : "Error"}
          </div>
          <div>{result.message}</div>
          {result.links && result.links.length > 0 ? (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              {result.links.map((link) => (
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
