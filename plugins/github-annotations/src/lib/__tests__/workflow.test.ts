import { describe, expect, it, vi } from "vitest";

import type { AnnotationPluginContext } from "@deshlo/core/annotations";

import type { RepoProvider } from "../githubProvider";
import { createManagedAnnotationsState, writeManagedAnnotationsState } from "../prState";
import {
  createThreadWithProvider,
  listThreadsWithProvider,
  replyThreadWithProvider,
  setThreadStatusWithProvider,
} from "../workflow";

const PLUGIN_CONTEXT: AnnotationPluginContext = {
  host: "localhost:3000",
  pageKey: "https://example.com/about",
  commitSha: "rev-1",
};

const REPO_CONFIG = {
  host: "localhost:3000",
  apiBaseUrl: "https://api.github.com",
  owner: "acme",
  repo: "demo",
  defaultBaseBranch: "main",
};

function createProviderMock(): RepoProvider {
  return {
    listBranches: vi.fn().mockResolvedValue(["main"]),
    listOpenPullRequests: vi.fn().mockResolvedValue([]),
    getBranchHeadSha: vi.fn().mockResolvedValue("base-sha"),
    getCommitTreeSha: vi.fn().mockResolvedValue("tree-sha"),
    createBranch: vi.fn().mockResolvedValue(undefined),
    createCommit: vi.fn().mockResolvedValue("commit-sha"),
    updateBranchHead: vi.fn().mockResolvedValue(undefined),
    updatePullRequestBody: vi.fn().mockResolvedValue(undefined),
    createDraftPullRequest: vi.fn().mockResolvedValue({
      prNumber: 7,
      prUrl: "https://example.com/pr/7",
    }),
  };
}

function createThreadInput() {
  return {
    pageKey: "https://example.com/about",
    commitSha: "rev-1",
    anchor: {
      viewport: { width: 100, height: 100 },
      pageScroll: { x: 0, y: 0 },
      targetRect: { left: 10, top: 10, width: 10, height: 10 },
      targetPoint: { x: 12, y: 14 },
      normalized: {
        viewportXRatio: 0.1,
        viewportYRatio: 0.1,
        rectXRatio: 0.2,
        rectYRatio: 0.3,
      },
      scrollChain: [],
    },
    body: "hello",
  };
}

describe("annotations workflow", () => {
  it("creates a managed draft PR for the commit when missing", async () => {
    const provider = createProviderMock();

    const result = await createThreadWithProvider(
      createThreadInput(),
      PLUGIN_CONTEXT,
      provider,
      REPO_CONFIG
    );

    expect(result.ok).toBe(true);
    expect(provider.createBranch).toHaveBeenCalledTimes(1);
    expect(provider.createCommit).toHaveBeenCalledTimes(1);
    expect(provider.createDraftPullRequest).toHaveBeenCalledTimes(1);
  });

  it("reuses existing managed draft PR for the same commit", async () => {
    const provider = createProviderMock();
    const state = createManagedAnnotationsState(
      "rev-1",
      {
        ...createThreadInput(),
        threadId: "thread-existing",
        status: "open",
        messages: [
          {
            messageId: "msg-1",
            body: "existing",
            createdAt: "2024-01-01T00:00:00.000Z",
          },
        ],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
      "2024-01-01T00:00:00.000Z"
    );

    (provider.listOpenPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        prNumber: 11,
        prUrl: "https://example.com/pr/11",
        draft: true,
        baseBranch: "main",
        headBranch: "deshlo-annotations/rev-1",
        body: writeManagedAnnotationsState("", state),
      },
    ]);

    const result = await createThreadWithProvider(
      createThreadInput(),
      PLUGIN_CONTEXT,
      provider,
      REPO_CONFIG
    );

    expect(result.ok).toBe(true);
    expect(provider.createDraftPullRequest).not.toHaveBeenCalled();
    expect(provider.updatePullRequestBody).toHaveBeenCalledTimes(1);
  });

  it("lists page threads and hides stale when requested", async () => {
    const provider = createProviderMock();
    const currentState = createManagedAnnotationsState(
      "rev-1",
      {
        ...createThreadInput(),
        threadId: "thread-current",
        status: "open",
        messages: [{ messageId: "m1", body: "current", createdAt: "2024-01-01T00:00:00.000Z" }],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
      "2024-01-01T00:00:00.000Z"
    );

    const staleState = createManagedAnnotationsState(
      "rev-2",
      {
        ...createThreadInput(),
        threadId: "thread-stale",
        commitSha: "rev-2",
        status: "open",
        messages: [{ messageId: "m2", body: "stale", createdAt: "2024-01-02T00:00:00.000Z" }],
        createdAt: "2024-01-02T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
      },
      "2024-01-02T00:00:00.000Z"
    );

    (provider.listOpenPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        prNumber: 11,
        prUrl: "https://example.com/pr/11",
        draft: true,
        baseBranch: "main",
        headBranch: "deshlo-annotations/rev-1",
        body: writeManagedAnnotationsState("", currentState),
      },
      {
        prNumber: 12,
        prUrl: "https://example.com/pr/12",
        draft: true,
        baseBranch: "main",
        headBranch: "deshlo-annotations/rev-2",
        body: writeManagedAnnotationsState("", staleState),
      },
    ]);

    const currentOnly = await listThreadsWithProvider({ includeStale: false }, PLUGIN_CONTEXT, provider);
    expect(currentOnly.map((thread) => thread.threadId)).toEqual(["thread-current"]);

    const all = await listThreadsWithProvider({ includeStale: true }, PLUGIN_CONTEXT, provider);
    expect(all).toHaveLength(2);
  });

  it("appends replies and updates thread status", async () => {
    const provider = createProviderMock();

    const state = createManagedAnnotationsState(
      "rev-1",
      {
        ...createThreadInput(),
        threadId: "thread-1",
        status: "open",
        messages: [{ messageId: "m1", body: "hello", createdAt: "2024-01-01T00:00:00.000Z" }],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
      "2024-01-01T00:00:00.000Z"
    );

    (provider.listOpenPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        prNumber: 11,
        prUrl: "https://example.com/pr/11",
        draft: true,
        baseBranch: "main",
        headBranch: "deshlo-annotations/rev-1",
        body: writeManagedAnnotationsState("", state),
      },
    ]);

    const replyResult = await replyThreadWithProvider(
      {
        threadId: "thread-1",
        pageKey: "https://example.com/about",
        commitSha: "rev-1",
        body: "reply",
      },
      provider
    );
    expect(replyResult.ok).toBe(true);

    const resolveResult = await setThreadStatusWithProvider(
      {
        threadId: "thread-1",
        pageKey: "https://example.com/about",
        commitSha: "rev-1",
      },
      "resolved",
      provider
    );
    expect(resolveResult.ok).toBe(true);

    expect(provider.updatePullRequestBody).toHaveBeenCalledTimes(2);
  });

  it("finds thread in the correct PR when multiple managed PRs share commit", async () => {
    const provider = createProviderMock();

    const threadOnSecondPr = createManagedAnnotationsState(
      "rev-1",
      {
        ...createThreadInput(),
        threadId: "thread-target",
        status: "open",
        messages: [{ messageId: "m-target", body: "hello", createdAt: "2024-01-02T00:00:00.000Z" }],
        createdAt: "2024-01-02T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
      },
      "2024-01-02T00:00:00.000Z"
    );

    const otherPrState = createManagedAnnotationsState(
      "rev-1",
      {
        ...createThreadInput(),
        threadId: "thread-other",
        status: "open",
        messages: [{ messageId: "m-other", body: "other", createdAt: "2024-01-01T00:00:00.000Z" }],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
      "2024-01-01T00:00:00.000Z"
    );

    (provider.listOpenPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        prNumber: 11,
        prUrl: "https://example.com/pr/11",
        draft: true,
        baseBranch: "main",
        headBranch: "deshlo-annotations/rev-1-a",
        body: writeManagedAnnotationsState("", otherPrState),
      },
      {
        prNumber: 12,
        prUrl: "https://example.com/pr/12",
        draft: true,
        baseBranch: "main",
        headBranch: "deshlo-annotations/rev-1-b",
        body: writeManagedAnnotationsState("", threadOnSecondPr),
      },
    ]);

    const replyResult = await replyThreadWithProvider(
      {
        threadId: "thread-target",
        pageKey: "https://example.com/wrong-page-key",
        commitSha: "rev-1",
        body: "reply",
      },
      provider
    );

    expect(replyResult.ok).toBe(true);
    expect(provider.updatePullRequestBody).toHaveBeenCalledTimes(1);
    expect(provider.updatePullRequestBody).toHaveBeenCalledWith(12, expect.any(String));
  });
});
