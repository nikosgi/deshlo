import { describe, expect, it } from "vitest";

import {
  createManagedPrState,
  parseManagedPrState,
  upsertManagedPrStateChange,
  writeManagedPrState,
} from "../prState";

describe("managed PR state body helpers", () => {
  it("parses valid state marker block", () => {
    const state = createManagedPrState(
      {
        branch: "main",
        commitSha: "rev-123",
      },
      {
        sourceLoc: "app/page.tsx:4:7",
        tagName: "h1",
        selectedText: "Hello",
        proposedText: "Updated",
        lastAppliedCommitSha: "commit-1",
        updatedAt: "2024-01-01T00:00:00.000Z",
      }
    );

    const body = writeManagedPrState("Managed PR", state);
    const parsed = parseManagedPrState(body);
    expect(parsed).not.toBeNull();
    expect(parsed?.base.commitSha).toBe("rev-123");
    expect(parsed?.changes).toHaveLength(1);
  });

  it("returns null for body without markers", () => {
    expect(parseManagedPrState("plain body")).toBeNull();
  });

  it("parses legacy split-marker state format", () => {
    const body = `Header
<!-- deshlo:state:start -->
{
  "version": 1,
  "managedBy": "deshlo/source-inspector",
  "base": { "branch": "main", "commitSha": "rev-123" },
  "changes": [],
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
<!-- deshlo:state:end -->`;

    const parsed = parseManagedPrState(body);
    expect(parsed).not.toBeNull();
    expect(parsed?.base.commitSha).toBe("rev-123");
  });

  it("returns null for invalid marker JSON", () => {
    const body = `Header
<!-- deshlo:state:start -->
{ invalid }
<!-- deshlo:state:end -->`;

    expect(parseManagedPrState(body)).toBeNull();
  });

  it("upserts by sourceLoc and replaces previous entry", () => {
    const state = createManagedPrState(
      {
        branch: "main",
        commitSha: "rev-123",
      },
      {
        sourceLoc: "app/page.tsx:4:7",
        tagName: "h1",
        selectedText: "Hello",
        proposedText: "Updated",
        lastAppliedCommitSha: "commit-1",
        updatedAt: "2024-01-01T00:00:00.000Z",
      }
    );

    const upserted = upsertManagedPrStateChange(state, {
      sourceLoc: "app/page.tsx:4:7",
      tagName: "h1",
      selectedText: "Hello",
      proposedText: "Second update",
      lastAppliedCommitSha: "commit-2",
      updatedAt: "2024-01-02T00:00:00.000Z",
    });

    expect(upserted.changes).toHaveLength(1);
    expect(upserted.changes[0].proposedText).toBe("Second update");
    expect(upserted.changes[0].lastAppliedCommitSha).toBe("commit-2");
  });

  it("writes body preserving non-managed text around markers", () => {
    const state = createManagedPrState(
      {
        branch: "main",
        commitSha: "rev-123",
      },
      {
        sourceLoc: "app/page.tsx:4:7",
        tagName: "h1",
        selectedText: "Hello",
        proposedText: "Updated",
        lastAppliedCommitSha: "commit-1",
        updatedAt: "2024-01-01T00:00:00.000Z",
      }
    );

    const firstBody = writeManagedPrState("Header text", state);
    const secondState = upsertManagedPrStateChange(state, {
      sourceLoc: "app/other.tsx:1:1",
      tagName: "p",
      selectedText: "a",
      proposedText: "b",
      lastAppliedCommitSha: "commit-2",
      updatedAt: "2024-01-02T00:00:00.000Z",
    });
    const rewritten = writeManagedPrState(firstBody, secondState);

    expect(rewritten).toContain("Header text");
    expect(rewritten).toContain("deshlo:state:start");
    expect(rewritten).toContain('"sourceLoc": "app/other.tsx:1:1"');
  });
});
