import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SourceInspectorError } from "../errors";
import type { RepoProvider } from "../githubProvider";
import { createManagedPrState, writeManagedPrState } from "../prState";
import {
  createDraftPrFromProposedChangeWithProvider,
  createDraftPrFromProposedChangesWithProvider,
  listProposedChangesWithProvider,
  previewProposedChangeWithProvider,
} from "../workflow";

const SOURCE = `export default function Page() {
  return (
    <main>
      <h1>Hello title</h1>
      <p>Hello body</p>
    </main>
  );
}
`;

function createProviderMock(): RepoProvider {
  return {
    listBranches: vi.fn().mockResolvedValue(["main"]),
    listOpenPullRequests: vi.fn().mockResolvedValue([]),
    getBranchHeadSha: vi.fn().mockResolvedValue("base-sha"),
    getCommitTreeSha: vi.fn().mockResolvedValue("tree-base-sha"),
    getFileContent: vi.fn().mockResolvedValue({
      content: SOURCE,
      sha: "file-sha",
    }),
    createBranch: vi.fn().mockResolvedValue(undefined),
    createTree: vi.fn().mockResolvedValue("tree-next-sha"),
    createCommit: vi.fn().mockResolvedValue("commit-sha"),
    updateBranchHead: vi.fn().mockResolvedValue(undefined),
    updatePullRequestBody: vi.fn().mockResolvedValue(undefined),
    updateFile: vi.fn().mockResolvedValue({ commitSha: "commit-sha" }),
    createDraftPullRequest: vi.fn().mockResolvedValue({
      prNumber: 42,
      prUrl: "https://example.com/pr/42",
    }),
  };
}

describe("workflow provider orchestration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-02T03:04:05.000Z"));
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    delete process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_GITHUB_PATH_PREFIX;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("previews deterministic replacement", async () => {
    const provider = createProviderMock();

    const preview = await previewProposedChangeWithProvider(
      {
        sourceLoc: "app/page.tsx:4:7",
        tagName: "h1",
        selectedText: "Hello title",
        proposedText: "Updated title",
        baseBranch: "main",
      },
      provider
    );

    expect(preview.filePath).toBe("app/page.tsx");
    expect(preview.oldText).toBe("Hello title");
    expect(preview.newText).toBe("Updated title");
    expect(preview.branchNamePreview).toContain("source-inspector/h1-1700000000000");
  });

  it("creates branch, single commit, and draft PR for batch submit", async () => {
    const provider = createProviderMock();

    const result = await createDraftPrFromProposedChangesWithProvider(
      [
        {
          sourceLoc: "app/page.tsx:4:7",
          tagName: "h1",
          selectedText: "Hello title",
          proposedText: "Updated title",
          baseBranch: "main",
          commitSha: "rev-123",
        },
        {
          sourceLoc: "app/page.tsx:5:7",
          tagName: "p",
          selectedText: "Hello body",
          proposedText: "Updated body",
          baseBranch: "main",
          commitSha: "rev-123",
        },
      ],
      provider
    );

    expect(provider.createBranch).toHaveBeenCalledTimes(1);
    expect(provider.createTree).toHaveBeenCalledTimes(1);
    expect(provider.createCommit).toHaveBeenCalledTimes(1);
    expect(provider.updateBranchHead).toHaveBeenCalledTimes(1);
    expect(provider.createDraftPullRequest).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("created");
    expect(result.affectedCount).toBe(2);
  });

  it("reuses matching managed draft PR and upserts state into body", async () => {
    const provider = createProviderMock();
    const managedState = createManagedPrState(
      {
        branch: "main",
        commitSha: "rev-123",
      },
      {
        sourceLoc: "app/page.tsx:4:7",
        tagName: "h1",
        selectedText: "Hello title",
        proposedText: "Hello title",
        lastAppliedCommitSha: "old-commit",
        updatedAt: "2024-01-01T00:00:00.000Z",
      }
    );
    const managedBody = writeManagedPrState("Managed PR", managedState);

    (provider.listOpenPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        prNumber: 101,
        prUrl: "https://example.com/pr/101",
        draft: true,
        baseBranch: "main",
        headBranch: "source-inspector/h1-existing",
        body: managedBody,
      },
    ]);

    const result = await createDraftPrFromProposedChangesWithProvider(
      [
        {
          sourceLoc: "app/page.tsx:4:7",
          tagName: "h1",
          selectedText: "Hello title",
          proposedText: "Updated title",
          baseBranch: "main",
          commitSha: "rev-123",
        },
      ],
      provider
    );

    expect(provider.createBranch).not.toHaveBeenCalled();
    expect(provider.createDraftPullRequest).not.toHaveBeenCalled();
    expect(provider.createTree).toHaveBeenCalledTimes(1);
    expect(provider.updatePullRequestBody).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("updated");
    expect(result.branchName).toBe("source-inspector/h1-existing");
    expect(result.prNumber).toBe(101);
  });

  it("does not reuse managed PR when base commit mismatches", async () => {
    const provider = createProviderMock();
    const managedState = createManagedPrState(
      {
        branch: "main",
        commitSha: "another-rev",
      },
      {
        sourceLoc: "app/page.tsx:4:7",
        tagName: "h1",
        selectedText: "Hello title",
        proposedText: "Old",
        lastAppliedCommitSha: "old-commit",
        updatedAt: "2024-01-01T00:00:00.000Z",
      }
    );

    (provider.listOpenPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        prNumber: 202,
        prUrl: "https://example.com/pr/202",
        draft: true,
        baseBranch: "main",
        headBranch: "source-inspector/h1-existing",
        body: writeManagedPrState("", managedState),
      },
    ]);

    const result = await createDraftPrFromProposedChangesWithProvider(
      [
        {
          sourceLoc: "app/page.tsx:4:7",
          tagName: "h1",
          selectedText: "Hello title",
          proposedText: "Updated title",
          baseBranch: "main",
          commitSha: "rev-123",
        },
      ],
      provider
    );

    expect(provider.createBranch).toHaveBeenCalledTimes(1);
    expect(provider.createDraftPullRequest).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("created");
  });

  it("rejects mixed revision batch before provider mutation", async () => {
    const provider = createProviderMock();

    await expect(
      createDraftPrFromProposedChangesWithProvider(
        [
          {
            sourceLoc: "app/page.tsx:4:7",
            tagName: "h1",
            selectedText: "Hello title",
            proposedText: "Updated title",
            baseBranch: "main",
            commitSha: "rev-1",
          },
          {
            sourceLoc: "app/page.tsx:5:7",
            tagName: "p",
            selectedText: "Hello body",
            proposedText: "Updated body",
            baseBranch: "main",
            commitSha: "rev-2",
          },
        ],
        provider
      )
    ).rejects.toThrow(SourceInspectorError);

    expect(provider.createBranch).not.toHaveBeenCalled();
    expect(provider.createTree).not.toHaveBeenCalled();
    expect(provider.createDraftPullRequest).not.toHaveBeenCalled();
  });

  it("supports compatibility single-submit through batch implementation", async () => {
    const provider = createProviderMock();

    const result = await createDraftPrFromProposedChangeWithProvider(
      {
        sourceLoc: "app/page.tsx:4:7",
        tagName: "h1",
        selectedText: "Hello title",
        proposedText: "Updated title",
        baseBranch: "main",
      },
      provider
    );

    expect(result.action).toBe("created");
    expect(result.affectedCount).toBe(1);
    expect(provider.createTree).toHaveBeenCalledTimes(1);
  });

  it("reuses matching managed draft PR and upserts state into body", async () => {
    const provider = createProviderMock();
    const managedState = createManagedPrState(
      {
        branch: "main",
        commitSha: "rev-123",
      },
      {
        sourceLoc: "app/page.tsx:4:7",
        tagName: "h1",
        selectedText: "Hello title",
        proposedText: "Hello title",
        lastAppliedCommitSha: "old-commit",
        updatedAt: "2024-01-01T00:00:00.000Z",
      }
    );
    const managedBody = writeManagedPrState("Managed PR", managedState);

    (provider.listOpenPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        prNumber: 101,
        prUrl: "https://example.com/pr/101",
        draft: true,
        baseBranch: "main",
        headBranch: "source-inspector/h1-existing",
        body: managedBody,
      },
    ]);

    const result = await createDraftPrFromProposedChangeWithProvider(
      {
        sourceLoc: "app/page.tsx:4:7",
        tagName: "h1",
        selectedText: "Hello title",
        proposedText: "Updated title",
        baseBranch: "main",
        commitSha: "rev-123",
      },
      provider
    );

    expect(provider.createBranch).not.toHaveBeenCalled();
    expect(provider.createDraftPullRequest).not.toHaveBeenCalled();
    expect(provider.updateFile).toHaveBeenCalledTimes(1);
    expect(provider.updatePullRequestBody).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("updated");
    expect(result.branchName).toBe("source-inspector/h1-existing");
    expect(result.prNumber).toBe(101);

    const [, updatedBody] = (provider.updatePullRequestBody as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updatedBody).toContain("deshlo:state:start");
    expect(updatedBody).toContain('"sourceLoc": "app/page.tsx:4:7"');
    expect(updatedBody).toContain('"proposedText": "Updated title"');
  });

  it("does not reuse managed PR when base commit mismatches", async () => {
    const provider = createProviderMock();
    const managedState = createManagedPrState(
      {
        branch: "main",
        commitSha: "another-rev",
      },
      {
        sourceLoc: "app/page.tsx:4:7",
        tagName: "h1",
        selectedText: "Hello title",
        proposedText: "Old",
        lastAppliedCommitSha: "old-commit",
        updatedAt: "2024-01-01T00:00:00.000Z",
      }
    );

    (provider.listOpenPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        prNumber: 202,
        prUrl: "https://example.com/pr/202",
        draft: true,
        baseBranch: "main",
        headBranch: "source-inspector/h1-existing",
        body: writeManagedPrState("", managedState),
      },
    ]);

    const result = await createDraftPrFromProposedChangeWithProvider(
      {
        sourceLoc: "app/page.tsx:4:7",
        tagName: "h1",
        selectedText: "Hello title",
        proposedText: "Updated title",
        baseBranch: "main",
        commitSha: "rev-123",
      },
      provider
    );

    expect(provider.createBranch).toHaveBeenCalledTimes(1);
    expect(provider.createDraftPullRequest).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("created");
  });

  it("surfaces BASE_BRANCH_NOT_FOUND from provider", async () => {
    const provider = createProviderMock();
    (provider.getBranchHeadSha as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new SourceInspectorError("BASE_BRANCH_NOT_FOUND", "Missing base branch")
    );

    await expect(
      previewProposedChangeWithProvider(
        {
          sourceLoc: "app/page.tsx:4:7",
          tagName: "h1",
          selectedText: "Hello title",
          proposedText: "Updated title",
          baseBranch: "main",
        },
        provider
      )
    ).rejects.toThrow(SourceInspectorError);
  });

  it("applies NEXT_PUBLIC_SOURCE_INSPECTOR_GITHUB_PATH_PREFIX to target file path", async () => {
    process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_GITHUB_PATH_PREFIX = "apps/next-test-app";
    const provider = createProviderMock();

    const preview = await previewProposedChangeWithProvider(
      {
        sourceLoc: "app/page.tsx:4:7",
        tagName: "h1",
        selectedText: "Hello title",
        proposedText: "Updated title",
        baseBranch: "main",
      },
      provider
    );

    expect(preview.filePath).toBe("apps/next-test-app/app/page.tsx");
    expect(provider.getFileContent).toHaveBeenCalledWith("apps/next-test-app/app/page.tsx", "main");
  });

  it("lists managed proposed changes from open PRs", async () => {
    const provider = createProviderMock();
    const state = createManagedPrState(
      {
        branch: "main",
        commitSha: "rev-123",
      },
      {
        sourceLoc: "app/page.tsx:4:7",
        tagName: "h1",
        selectedText: "Hello title",
        proposedText: "Updated title",
        lastAppliedCommitSha: "commit-sha",
        updatedAt: "2024-01-02T03:04:05.000Z",
      }
    );

    (provider.listOpenPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        prNumber: 303,
        prUrl: "https://example.com/pr/303",
        draft: true,
        baseBranch: "main",
        headBranch: "source-inspector/h1-existing",
        body: writeManagedPrState("Managed", state),
      },
      {
        prNumber: 304,
        prUrl: "https://example.com/pr/304",
        draft: true,
        baseBranch: "main",
        headBranch: "source-inspector/ignored",
        body: "No markers here",
      },
    ]);

    const changes = await listProposedChangesWithProvider(provider);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      sourceLoc: "app/page.tsx:4:7",
      proposedText: "Updated title",
      baseCommitSha: "rev-123",
      prNumber: 303,
    });
  });
});
