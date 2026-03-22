import { beforeEach, describe, expect, it, vi } from "vitest";

import { SourceInspectorError } from "../errors";
import type { RepoProvider } from "../githubProvider";
import {
  createDraftPrFromProposedChangeWithProvider,
  previewProposedChangeWithProvider,
} from "../workflow";

const SOURCE = `export default function Page() {
  return (
    <main>
      <h1>Hello title</h1>
    </main>
  );
}
`;

function createProviderMock(): RepoProvider {
  return {
    listBranches: vi.fn().mockResolvedValue(["main"]),
    getBranchHeadSha: vi.fn().mockResolvedValue("base-sha"),
    getFileContent: vi.fn().mockResolvedValue({
      content: SOURCE,
      sha: "file-sha",
    }),
    createBranch: vi.fn().mockResolvedValue(undefined),
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
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    delete process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_GITHUB_PATH_PREFIX;
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

  it("creates branch, commit and draft PR", async () => {
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

    expect(provider.createBranch).toHaveBeenCalledTimes(1);
    expect(provider.updateFile).toHaveBeenCalledTimes(1);
    expect(provider.createDraftPullRequest).toHaveBeenCalledTimes(1);
    expect(result.branchName).toContain("source-inspector/h1-1700000000000");
    expect(result.commitSha).toBe("commit-sha");
    expect(result.prNumber).toBe(42);
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
});
