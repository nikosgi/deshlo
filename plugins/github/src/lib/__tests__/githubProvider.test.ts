import { describe, expect, it, vi } from "vitest";

import { SourceInspectorError } from "../errors";
import { createGitHubProvider } from "../githubProvider";

const REPO_CONFIG = {
  host: "example.com",
  apiBaseUrl: "https://api.github.com",
  owner: "acme",
  repo: "demo",
};

describe("createGitHubProvider", () => {
  it("throws AUTH_REQUIRED when token is missing", () => {
    expect(() => createGitHubProvider(REPO_CONFIG, "")).toThrow(SourceInspectorError);
  });

  it("creates branch, updates file, and opens draft PR", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ data: { commit: { sha: "commit-sha" } } })
      .mockResolvedValueOnce({ data: { number: 7, html_url: "https://example.com/pr/7" } });

    const provider = createGitHubProvider(REPO_CONFIG, "token", { request } as any);

    await provider.createBranch("source-inspector/h1-1", "base-sha");
    const commit = await provider.updateFile({
      path: "app/page.tsx",
      branch: "source-inspector/h1-1",
      sha: "file-sha",
      content: "hello",
      message: "update",
    });
    const pr = await provider.createDraftPullRequest({
      title: "title",
      body: "body",
      head: "source-inspector/h1-1",
      base: "main",
    });

    expect(commit.commitSha).toBe("commit-sha");
    expect(pr.prNumber).toBe(7);
    expect(pr.prUrl).toBe("https://example.com/pr/7");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("lists open PRs and updates PR body", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            number: 9,
            html_url: "https://example.com/pr/9",
            draft: true,
            body: "test",
            base: { ref: "main" },
            head: { ref: "branch-1" },
          },
        ],
      })
      .mockResolvedValueOnce({});

    const provider = createGitHubProvider(REPO_CONFIG, "token", { request } as any);

    const openPrs = await provider.listOpenPullRequests();
    await provider.updatePullRequestBody(9, "updated");

    expect(openPrs).toEqual([
      {
        prNumber: 9,
        prUrl: "https://example.com/pr/9",
        draft: true,
        baseBranch: "main",
        headBranch: "branch-1",
        body: "test",
      },
    ]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("maps missing base branch to BASE_BRANCH_NOT_FOUND", async () => {
    const request = vi.fn().mockRejectedValue({ status: 404 });
    const provider = createGitHubProvider(REPO_CONFIG, "token", { request } as any);

    await expect(provider.getBranchHeadSha("does-not-exist")).rejects.toMatchObject({
      code: "BASE_BRANCH_NOT_FOUND",
    });
  });

  it("maps unauthorized response to AUTH_REQUIRED", async () => {
    const request = vi.fn().mockRejectedValue({ status: 401 });
    const provider = createGitHubProvider(REPO_CONFIG, "token", { request } as any);

    await expect(provider.listBranches()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});
