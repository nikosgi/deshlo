"use client";

import { useSourceInspectorContext } from "./source-inspector-context";

export default function OverlayGateBubbles() {
  const {
    inspectorEnabled,
    bubbleMode,
    stagedChanges,
    bubbleAnchors,
    expandedBubbles,
    toggleBubble,
    removeStagedChange,
    setStagedChangeProposedText,
    focusStagedChange,
    jumpToStagedChange,
  } = useSourceInspectorContext();

  if (!inspectorEnabled || bubbleMode === "off" || stagedChanges.length === 0) {
    return null;
  }

  return (
    <>
      {stagedChanges.map((stagedChange) => {
        const anchor = bubbleAnchors[stagedChange.sourceLoc];
        if (!anchor?.anchored) {
          return null;
        }

        const bubbleExpanded = Boolean(expandedBubbles[stagedChange.sourceLoc]);

        return (
          <div
            key={stagedChange.sourceLoc}
            style={{
              position: "fixed",
              top: anchor.top,
              left: anchor.left,
              zIndex: 9998,
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <button
              onClick={() => {
                toggleBubble(stagedChange.sourceLoc);
              }}
              style={{
                width: 24,
                height: 24,
                borderRadius: "999px",
                border: "1px solid #f59e0b",
                background: "#f59e0b",
                color: "#111827",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
              }}
              title={`Staged change at ${stagedChange.sourceLoc}`}
            >
              {bubbleExpanded ? "-" : "+"}
            </button>

            {bubbleExpanded ? (
              <div
                style={{
                  position: "absolute",
                  top: 28,
                  right: 0,
                  width: 320,
                  borderRadius: 10,
                  border: "1px solid #f59e0b",
                  background: "rgba(17, 17, 17, 0.96)",
                  color: "#f8fafc",
                  padding: 10,
                  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Staged Change</div>
                <div style={{ marginBottom: 4 }}>
                  <strong>{stagedChange.tagName}</strong> at <code>{stagedChange.sourceLoc}</code>
                </div>
                <div style={{ marginBottom: 4 }}>
                  Current: <code>{stagedChange.selectedText}</code>
                </div>
                <div style={{ marginBottom: 8 }}>
                  Revision: <code>{stagedChange.commitSha || "unknown"}</code>
                </div>
                <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>
                  Proposed changes
                </label>
                <textarea
                  value={stagedChange.proposedText}
                  onChange={(event) => {
                    setStagedChangeProposedText(stagedChange.sourceLoc, event.target.value);
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
                    marginBottom: 8,
                  }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => {
                      jumpToStagedChange(stagedChange.sourceLoc);
                    }}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid #334155",
                      background: "transparent",
                      color: "#f8fafc",
                      cursor: "pointer",
                    }}
                  >
                    Jump
                  </button>
                  <button
                    onClick={() => {
                      focusStagedChange(stagedChange.sourceLoc);
                    }}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid #334155",
                      background: "transparent",
                      color: "#f8fafc",
                      cursor: "pointer",
                    }}
                  >
                    Select
                  </button>
                  <button
                    onClick={() => {
                      removeStagedChange(stagedChange.sourceLoc);
                    }}
                    style={{
                      marginLeft: "auto",
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid #ef4444",
                      background: "transparent",
                      color: "#fecaca",
                      cursor: "pointer",
                    }}
                  >
                    Remove
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
