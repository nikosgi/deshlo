import { Octokit } from "@octokit/core";

import { SourceInspectorError } from "./errors";
import type { ResolvedRepoConfig } from "./hostConfig";

export interface FileContentResponse {
  content: string;
  sha: string;
}

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
  getFileContent(path: string, ref: string): Promise<FileContentResponse>;
  createBranch(branch: string, baseSha: string): Promise<void>;
  updatePullRequestBody(prNumber: number, body: string): Promise<void>;
  updateFile(params: {
    path: string;
    branch: string;
    sha: string;
    content: string;
    message: string;
  }): Promise<{ commitSha: string }>;
  createDraftPullRequest(params: {
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<PullRequestResponse>;
}

type OctokitLike = Pick<Octokit, "request">;

function decodeBase64Utf8(value: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64").toString("utf8");
  }

  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(value: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf8").toString("base64");
  }

  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function toProviderError(error: unknown): never {
  const status = (error as { status?: number })?.status;

  if (status === 401 || status === 403) {
    throw new SourceInspectorError(
      "AUTH_REQUIRED",
      "GitHub authentication failed. Provide a valid token with repo and pull request access."
    );
  }

  if (status === 404) {
    throw new SourceInspectorError("PROVIDER_ERROR", "GitHub resource was not found.");
  }

  throw new SourceInspectorError(
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
    throw new SourceInspectorError("AUTH_REQUIRED", "GitHub token is required.");
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
          throw new SourceInspectorError(
            "BASE_BRANCH_NOT_FOUND",
            `Base branch ${branch} was not found.`
          );
        }

        toProviderError(error);
      }
    },

    async getFileContent(path: string, ref: string) {
      try {
        const response = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
          owner: config.owner,
          repo: config.repo,
          path,
          ref,
        });

        if (
          Array.isArray(response.data) ||
          !("content" in response.data) ||
          typeof response.data.content !== "string"
        ) {
          throw new SourceInspectorError(
            "FILE_NOT_FOUND",
            `Path ${path} is not a regular text file in branch ${ref}.`
          );
        }

        const decoded = decodeBase64Utf8(response.data.content.replace(/\n/g, ""));

        return {
          content: decoded,
          sha: response.data.sha,
        };
      } catch (error) {
        const status = (error as { status?: number })?.status;
        if (status === 404) {
          throw new SourceInspectorError(
            "FILE_NOT_FOUND",
            `File ${path} was not found on branch ${ref}.`
          );
        }

        if (error instanceof SourceInspectorError) {
          throw error;
        }

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
          throw new SourceInspectorError(
            "PROVIDER_ERROR",
            `Branch ${branch} already exists. Retry the request.`
          );
        }

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

    async updateFile({ path, branch, sha, content, message }) {
      try {
        const response = await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
          owner: config.owner,
          repo: config.repo,
          path,
          branch,
          message,
          sha,
          content: encodeBase64Utf8(content),
        });

        const commitSha = response.data.commit?.sha;
        if (!commitSha) {
          throw new SourceInspectorError(
            "PROVIDER_ERROR",
            "GitHub did not return a commit SHA for the file update."
          );
        }

        return {
          commitSha,
        };
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
