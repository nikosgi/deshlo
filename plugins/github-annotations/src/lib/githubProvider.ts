import { Octokit } from "@octokit/core";

import { AnnotationProviderError } from "./errors";
import type { ResolvedRepoConfig } from "./hostConfig";

export interface PullRequestResponse {
  prNumber: number;
  prUrl: string;
}

export interface OpenPullRequestResponse extends PullRequestResponse {
  draft: boolean;
  baseBranch: string;
  headBranch: string;
  body: string;
}

export interface RepoProvider {
  listBranches(): Promise<string[]>;
  listOpenPullRequests(): Promise<OpenPullRequestResponse[]>;
  getBranchHeadSha(branch: string): Promise<string>;
  getCommitTreeSha(commitSha: string): Promise<string>;
  createBranch(branch: string, baseSha: string): Promise<void>;
  createCommit(params: {
    message: string;
    treeSha: string;
    parentCommitSha: string;
  }): Promise<string>;
  updateBranchHead(params: { branch: string; commitSha: string }): Promise<void>;
  updatePullRequestBody(prNumber: number, body: string): Promise<void>;
  createDraftPullRequest(params: {
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<PullRequestResponse>;
}

type OctokitLike = Pick<Octokit, "request">;

function toProviderError(error: unknown): never {
  const status = (error as { status?: number })?.status;

  if (status === 401 || status === 403) {
    throw new AnnotationProviderError(
      "AUTH_REQUIRED",
      "GitHub authentication failed. Provide a valid token with repository and pull request access."
    );
  }

  throw new AnnotationProviderError(
    "PROVIDER_ERROR",
    error instanceof Error ? error.message : "GitHub API request failed."
  );
}

export function createGitHubProvider(
  config: ResolvedRepoConfig,
  token: string,
  client?: OctokitLike
): RepoProvider {
  const authToken = token.trim();

  if (!authToken) {
    throw new AnnotationProviderError("AUTH_REQUIRED", "GitHub token is required.");
  }

  const octokit: OctokitLike =
    client ||
    new Octokit({
      baseUrl: config.apiBaseUrl,
      auth: authToken,
    });

  return {
    async listBranches() {
      try {
        const response = await octokit.request("GET /repos/{owner}/{repo}/branches", {
          owner: config.owner,
          repo: config.repo,
          per_page: 100,
        });

        return response.data.map((branch: { name: string }) => branch.name);
      } catch (error) {
        toProviderError(error);
      }
    },

    async listOpenPullRequests() {
      try {
        const response = await octokit.request("GET /repos/{owner}/{repo}/pulls", {
          owner: config.owner,
          repo: config.repo,
          state: "open",
          per_page: 100,
        });

        return response.data.map(
          (pr: {
            number: number;
            html_url: string;
            draft?: boolean;
            body?: string | null;
            base: { ref: string };
            head: { ref: string };
          }) => ({
            prNumber: pr.number,
            prUrl: pr.html_url,
            draft: Boolean(pr.draft),
            baseBranch: pr.base.ref,
            headBranch: pr.head.ref,
            body: pr.body || "",
          })
        );
      } catch (error) {
        toProviderError(error);
      }
    },

    async getBranchHeadSha(branch: string) {
      try {
        const response = await octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
          owner: config.owner,
          repo: config.repo,
          ref: `heads/${branch}`,
        });

        return response.data.object.sha as string;
      } catch (error) {
        const status = (error as { status?: number })?.status;
        if (status === 404) {
          throw new AnnotationProviderError(
            "BASE_BRANCH_NOT_FOUND",
            `Base branch ${branch} was not found.`
          );
        }

        toProviderError(error);
      }
    },

    async getCommitTreeSha(commitSha: string) {
      try {
        const response = await octokit.request("GET /repos/{owner}/{repo}/git/commits/{commit_sha}", {
          owner: config.owner,
          repo: config.repo,
          commit_sha: commitSha,
        });

        const treeSha = response.data.tree?.sha;
        if (!treeSha) {
          throw new AnnotationProviderError(
            "PROVIDER_ERROR",
            `Could not resolve tree SHA for commit ${commitSha}.`
          );
        }

        return treeSha;
      } catch (error) {
        toProviderError(error);
      }
    },

    async createBranch(branch: string, baseSha: string) {
      try {
        await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
          owner: config.owner,
          repo: config.repo,
          ref: `refs/heads/${branch}`,
          sha: baseSha,
        });
      } catch (error) {
        const status = (error as { status?: number })?.status;
        if (status === 422) {
          throw new AnnotationProviderError(
            "PROVIDER_ERROR",
            `Branch ${branch} already exists. Retry the request.`
          );
        }

        toProviderError(error);
      }
    },

    async createCommit({ message, treeSha, parentCommitSha }) {
      try {
        const response = await octokit.request("POST /repos/{owner}/{repo}/git/commits", {
          owner: config.owner,
          repo: config.repo,
          message,
          tree: treeSha,
          parents: [parentCommitSha],
        });

        return response.data.sha;
      } catch (error) {
        toProviderError(error);
      }
    },

    async updateBranchHead({ branch, commitSha }) {
      try {
        await octokit.request("PATCH /repos/{owner}/{repo}/git/refs/{ref}", {
          owner: config.owner,
          repo: config.repo,
          ref: `heads/${branch}`,
          sha: commitSha,
          force: false,
        });
      } catch (error) {
        toProviderError(error);
      }
    },

    async updatePullRequestBody(prNumber: number, body: string) {
      try {
        await octokit.request("PATCH /repos/{owner}/{repo}/pulls/{pull_number}", {
          owner: config.owner,
          repo: config.repo,
          pull_number: prNumber,
          body,
        });
      } catch (error) {
        toProviderError(error);
      }
    },

    async createDraftPullRequest({ title, body, head, base }) {
      try {
        const response = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
          owner: config.owner,
          repo: config.repo,
          title,
          body,
          head,
          base,
          draft: true,
        });

        return {
          prNumber: response.data.number,
          prUrl: response.data.html_url,
        };
      } catch (error) {
        toProviderError(error);
      }
    },
  };
}
