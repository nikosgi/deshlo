import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/workflow", () => ({
  getBranches: vi.fn().mockResolvedValue({
    branches: ["main"],
    defaultBaseBranch: "main",
  }),
  createDraftPrFromProposedChange: vi.fn(),
  createDraftPrFromProposedChanges: vi.fn(),
  listProposedChanges: vi.fn().mockResolvedValue([]),
}));

import {
  createDraftPrFromProposedChange,
  createDraftPrFromProposedChanges,
  listProposedChanges,
} from "../lib/workflow";
import { createGitHubBrowserPlugin } from "../plugin";

describe("createGitHubBrowserPlugin", () => {
  it("returns AUTH_REQUIRED when token is missing", async () => {
    const plugin = createGitHubBrowserPlugin({
      token: "",
    });

    const result = await plugin.submit(
      {
        sourceLoc: "app/page.tsx:1:1",
        tagName: "h1",
        selectedText: "Old",
        proposedText: "New",
      },
      { host: "localhost:3000" }
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("AUTH_REQUIRED");
  });

  it("returns empty list when token is missing", async () => {
    const plugin = createGitHubBrowserPlugin({
      token: "",
    });

    const changes = await plugin.listProposedChanges?.({ host: "localhost:3000" });
    expect(changes).toEqual([]);
  });

  it("maps workflow success to submit result message and links", async () => {
    vi.mocked(createDraftPrFromProposedChange).mockResolvedValue({
      action: "updated",
      branchName: "source-inspector/h1-1",
      commitSha: "commit-sha",
      prNumber: 42,
      prUrl: "https://example.com/pr/42",
    });

    const plugin = createGitHubBrowserPlugin({
      token: "token",
      baseBranch: "main",
    });

    const result = await plugin.submit(
      {
        sourceLoc: "app/page.tsx:1:1",
        tagName: "h1",
        selectedText: "Old",
        proposedText: "New",
      },
      { host: "localhost:3000" }
    );

    expect(result.ok).toBe(true);
    expect(result.message).toContain("updated");
    expect(result.links).toEqual([
      {
        label: "Open PR #42",
        url: "https://example.com/pr/42",
      },
    ]);
  });

  it("maps batch workflow success to batch submit result", async () => {
    vi.mocked(createDraftPrFromProposedChanges).mockResolvedValue({
      action: "created",
      branchName: "source-inspector/batch-1",
      commitSha: "commit-sha",
      prNumber: 84,
      prUrl: "https://example.com/pr/84",
      affectedCount: 2,
    });

    const plugin = createGitHubBrowserPlugin({
      token: "token",
      baseBranch: "main",
    });

    const result = await plugin.submitBatch?.(
      {
        changes: [
          {
            sourceLoc: "app/page.tsx:1:1",
            tagName: "h1",
            selectedText: "Old 1",
            proposedText: "New 1",
          },
          {
            sourceLoc: "app/page.tsx:2:1",
            tagName: "p",
            selectedText: "Old 2",
            proposedText: "New 2",
          },
        ],
      },
      { host: "localhost:3000" }
    );

    expect(result).toMatchObject({
      ok: true,
      submittedCount: 2,
    });
    expect(result?.message).toContain("84");
  });

  it("delegates listProposedChanges to workflow list API", async () => {
    vi.mocked(listProposedChanges).mockResolvedValue([
      {
        changeId: "x",
        sourceLoc: "app/page.tsx:1:1",
        tagName: "h1",
        selectedText: "Old",
        proposedText: "New",
        status: "pending",
        baseBranch: "main",
        baseCommitSha: "rev-1",
        lastAppliedCommitSha: "commit-1",
        updatedAt: "2024-01-01T00:00:00.000Z",
        prNumber: 1,
        prUrl: "https://example.com/pr/1",
      },
    ]);

    const plugin = createGitHubBrowserPlugin({
      token: "token",
      baseBranch: "main",
    });

    const changes = await plugin.listProposedChanges?.({ host: "localhost:3000" });
    expect(changes).toHaveLength(1);
    expect(changes?.[0].sourceLoc).toBe("app/page.tsx:1:1");
  });
});
