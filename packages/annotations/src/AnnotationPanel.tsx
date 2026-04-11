"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  AnnotationCommitHistoryEntry,
  AnnotationListCommitHistoryHandler,
  AnnotationResultLink,
} from "./annotation-plugin";
import { useAnnotationContext } from "./annotation-context";

interface GitHubHostRepoConfig {
  apiBaseUrl?: string;
  owner: string;
  repo: string;
  defaultBaseBranch?: string;
}

interface ResolvedGitHubRepoConfig extends GitHubHostRepoConfig {
  apiBaseUrl: string;
}

interface GitHubCommit {
  sha: string;
  htmlUrl: string;
  message: string;
  committedAt: string;
  branches: string[];
}

interface CommitStats {
  commitSha: string;
  threads: number;
  comments: number;
  latestUpdatedAt: string;
}

const DEFAULT_BRANCHES_LIMIT = 8;
const DEFAULT_COMMITS_PER_BRANCH = 200;
const GRAPHQL_BATCH_SIZE = 25;

export interface AnnotationPanelProps {
  width?: number;
  githubToken?: string;
  githubHostConfig?: string | Record<string, GitHubHostRepoConfig>;
  githubBranch?: string;
  githubBranchesLimit?: number;
  listCommitHistory?: AnnotationListCommitHistoryHandler;
}

function stripPort(host: string): string {
  const index = host.indexOf(":");
  if (index === -1) {
    return host;
  }

  return host.slice(0, index);
}

function resolveToken(override?: string): string {
  return (
    override?.trim() ||
    process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_GITHUB_TOKEN?.trim() ||
    process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_GITHUB_TOKEN?.trim() ||
    ""
  );
}

function parseHostConfig(
  input?: string | Record<string, GitHubHostRepoConfig>
): Record<string, GitHubHostRepoConfig> | null {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input;
  }

  const raw =
    (typeof input === "string" ? input : process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_HOST_CONFIG) ||
    process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_HOST_CONFIG;

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, GitHubHostRepoConfig>;
  } catch {
    return null;
  }
}

function resolveRepoConfig(
  host: string,
  mapping: Record<string, GitHubHostRepoConfig> | null
): ResolvedGitHubRepoConfig | null {
  if (!host || !mapping) {
    return null;
  }

  const normalizedHost = host.trim().toLowerCase();
  const hostWithoutPort = stripPort(normalizedHost);
  const config = mapping[normalizedHost] ?? mapping[hostWithoutPort];

  if (!config || !config.owner || !config.repo) {
    return null;
  }

  return {
    ...config,
    apiBaseUrl: config.apiBaseUrl?.trim() || "https://api.github.com",
  };
}

function resolveBranchesLimit(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_BRANCHES_LIMIT;
  }

  return Math.max(1, Math.min(30, Math.floor(value || DEFAULT_BRANCHES_LIMIT)));
}

function toCommitMessage(raw: string): string {
  return raw.split("\n")[0]?.trim() || "(no message)";
}

function toCommitDate(commit: any): string {
  return (
    commit?.commit?.committer?.date ||
    commit?.commit?.author?.date ||
    ""
  );
}

function compareCommittedAtDesc(left: GitHubCommit, right: GitHubCommit): number {
  return right.committedAt.localeCompare(left.committedAt);
}

function isMatchingCommitSha(left: string, right: string): boolean {
  return left === right || left.startsWith(right) || right.startsWith(left);
}

async function fetchBranches(params: {
  token: string;
  repo: ResolvedGitHubRepoConfig;
  preferredBranch?: string;
  limit: number;
}): Promise<string[]> {
  const { token, repo, preferredBranch, limit } = params;
  const baseUrl = repo.apiBaseUrl.replace(/\/$/, "");
  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  const response = await fetch(
    `${baseUrl}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/branches?per_page=${Math.max(limit * 2, 20)}`,
    {
      method: "GET",
      headers,
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to load branches (${response.status}).`);
  }

  const body = (await response.json()) as Array<{ name?: string }>;
  const names = new Set<string>();

  if (preferredBranch?.trim()) {
    names.add(preferredBranch.trim());
  } else if (repo.defaultBaseBranch?.trim()) {
    names.add(repo.defaultBaseBranch.trim());
  }

  for (const entry of body) {
    if (entry?.name) {
      names.add(entry.name);
    }
    if (names.size >= limit) {
      break;
    }
  }

  return Array.from(names).slice(0, limit);
}

async function fetchBranchCommitShas(params: {
  token: string;
  repo: ResolvedGitHubRepoConfig;
  branch: string;
}): Promise<string[]> {
  const { token, repo, branch } = params;
  const baseUrl = repo.apiBaseUrl.replace(/\/$/, "");
  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  const response = await fetch(
    `${baseUrl}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/commits?sha=${encodeURIComponent(branch)}&per_page=${DEFAULT_COMMITS_PER_BRANCH}`,
    {
      method: "GET",
      headers,
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to load commits for branch ${branch} (${response.status}).`);
  }

  const commits = (await response.json()) as any[];
  if (!Array.isArray(commits) || commits.length === 0) {
    return [];
  }

  return commits
    .map((entry) => (typeof entry?.sha === "string" ? entry.sha : ""))
    .filter((sha) => sha.length > 0);
}

async function fetchCommitBySha(params: {
  token: string;
  repo: ResolvedGitHubRepoConfig;
  sha: string;
}): Promise<GitHubCommit | null> {
  const { token, repo, sha } = params;
  const baseUrl = repo.apiBaseUrl.replace(/\/$/, "");
  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  const response = await fetch(
    `${baseUrl}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/commits/${encodeURIComponent(sha)}`,
    {
      method: "GET",
      headers,
    }
  );

  if (!response.ok) {
    return null;
  }

  const entry = (await response.json()) as any;
  if (!entry?.sha) {
    return null;
  }

  return {
    sha: entry.sha,
    htmlUrl: entry.html_url || "",
    message: toCommitMessage(entry?.commit?.message || ""),
    committedAt: toCommitDate(entry),
    branches: [],
  };
}

function resolveCommitBranches(targetSha: string, branchIndex: Map<string, string[]>): string[] {
  const exact = branchIndex.get(targetSha);
  if (exact) {
    return exact;
  }

  for (const [sha, branches] of branchIndex.entries()) {
    if (isMatchingCommitSha(sha, targetSha)) {
      return branches;
    }
  }

  return [];
}

function resolveGraphQLEndpoint(apiBaseUrl: string): string {
  const normalized = apiBaseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/graphql")) {
    return normalized;
  }
  if (normalized === "https://api.github.com") {
    return "https://api.github.com/graphql";
  }
  if (normalized.endsWith("/api/v3")) {
    return `${normalized.slice(0, -"/api/v3".length)}/api/graphql`;
  }
  return `${normalized}/graphql`;
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function buildCommitBatchQuery(batchSize: number): { query: string; exprKeys: string[] } {
  const exprKeys = Array.from({ length: batchSize }, (_, index) => `expr${index}`);
  const variableDefinitions = exprKeys
    .map((key) => `$${key}: String!`)
    .join(", ");
  const commitFields = exprKeys
    .map(
      (key, index) => `
      c${index}: object(expression: $${key}) {
        ... on Commit {
          oid
          messageHeadline
          committedDate
          url
        }
      }`
    )
    .join("\n");

  return {
    exprKeys,
    query: `
      query DeshloBatchCommits($owner: String!, $repo: String!, ${variableDefinitions}) {
        repository(owner: $owner, name: $repo) {
          ${commitFields}
        }
      }
    `,
  };
}

function resolveCommitFromMap(targetSha: string, bySha: Map<string, GitHubCommit>): GitHubCommit | null {
  const exact = bySha.get(targetSha);
  if (exact) {
    return exact;
  }

  for (const [sha, commit] of bySha.entries()) {
    if (isMatchingCommitSha(sha, targetSha)) {
      return commit;
    }
  }

  return null;
}

async function fetchCommitsByGraphQL(params: {
  token: string;
  repo: ResolvedGitHubRepoConfig;
  commitShas: string[];
}): Promise<Map<string, GitHubCommit>> {
  const { token, repo, commitShas } = params;
  const endpoint = resolveGraphQLEndpoint(repo.apiBaseUrl);
  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  const bySha = new Map<string, GitHubCommit>();
  const batches = chunkValues(commitShas, GRAPHQL_BATCH_SIZE);

  for (const batch of batches) {
    const { query, exprKeys } = buildCommitBatchQuery(batch.length);
    const variables: Record<string, string> = {
      owner: repo.owner,
      repo: repo.repo,
    };
    batch.forEach((sha, index) => {
      variables[exprKeys[index]] = sha;
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      throw new Error(`Failed to load commit metadata via GraphQL (${response.status}).`);
    }

    const body = (await response.json()) as any;
    const repository = body?.data?.repository;
    if (!repository || typeof repository !== "object") {
      continue;
    }

    batch.forEach((requestedSha, index) => {
      const node = repository[`c${index}`];
      if (!node?.oid) {
        return;
      }

      const commit: GitHubCommit = {
        sha: node.oid,
        htmlUrl: node.url || "",
        message: toCommitMessage(node.messageHeadline || ""),
        committedAt: node.committedDate || "",
        branches: [],
      };

      bySha.set(requestedSha, commit);
      bySha.set(commit.sha, commit);
    });
  }

  return bySha;
}

function resolveStatsForCommit(
  targetSha: string,
  statsByCommit: Map<string, CommitStats>
): CommitStats | undefined {
  const exact = statsByCommit.get(targetSha);
  if (exact) {
    return exact;
  }

  for (const [sha, stats] of statsByCommit.entries()) {
    if (isMatchingCommitSha(sha, targetSha)) {
      return stats;
    }
  }

  return undefined;
}

async function fetchCommitsForThreadShas(params: {
  token: string;
  repo: ResolvedGitHubRepoConfig;
  commitShas: string[];
  branch?: string;
  branchesLimit: number;
}): Promise<GitHubCommit[]> {
  const { token, repo, commitShas, branch, branchesLimit } = params;
  if (commitShas.length === 0) {
    return [];
  }

  const selectedBranch = branch?.trim();
  const branches = await fetchBranches({
    token,
    repo,
    preferredBranch: selectedBranch || repo.defaultBaseBranch,
    limit: branchesLimit,
  });

  if (branches.length === 0) {
    return [];
  }

  const branchCommitShas = await Promise.all(
    branches.map(async (branchName) => {
      const shas = await fetchBranchCommitShas({
        token,
        repo,
        branch: branchName,
      });

      return { branchName, shas };
    })
  );

  const branchIndex = new Map<string, string[]>();
  for (const branchEntry of branchCommitShas) {
    for (const sha of branchEntry.shas) {
      const existing = branchIndex.get(sha);
      if (!existing) {
        branchIndex.set(sha, [branchEntry.branchName]);
        continue;
      }

      if (!existing.includes(branchEntry.branchName)) {
        existing.push(branchEntry.branchName);
      }
    }
  }

  const uniqueShas = Array.from(new Set(commitShas));
  let graphQlBySha = new Map<string, GitHubCommit>();
  try {
    graphQlBySha = await fetchCommitsByGraphQL({
      token,
      repo,
      commitShas: uniqueShas,
    });
  } catch {
    graphQlBySha = new Map<string, GitHubCommit>();
  }

  const commits = await Promise.all(
    uniqueShas.map(async (targetSha) => {
      const fromGraphQl = resolveCommitFromMap(targetSha, graphQlBySha);
      const meta =
        fromGraphQl ||
        (await fetchCommitBySha({
          token,
          repo,
          sha: targetSha,
        }));
      if (!meta) {
        return null;
      }

      return {
        ...meta,
        branches: resolveCommitBranches(meta.sha, branchIndex),
      } satisfies GitHubCommit;
    })
  );

  return commits.filter((entry): entry is GitHubCommit => Boolean(entry)).sort(compareCommittedAtDesc);
}

export default function AnnotationPanel({
  width = 420,
  githubToken,
  githubHostConfig,
  githubBranch,
  githubBranchesLimit,
  listCommitHistory,
}: AnnotationPanelProps) {
  const {
    enabled,
    readOnly,
    triggerKey,
    pluginId,
    pageKey,
    currentCommitSha,
    selectedCommitSha,
    loading,
    result,
    currentThreads,
    staleThreads,
    showStale,
    setShowStale,
    setSelectedCommitSha,
    refreshThreads,
  } = useAnnotationContext();

  const [githubCommits, setGithubCommits] = useState<GitHubCommit[]>([]);
  const [providerCommitHistory, setProviderCommitHistory] = useState<AnnotationCommitHistoryEntry[]>([]);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);

  const commitStats = useMemo(() => {
    const byCommit = new Map<
      string,
      CommitStats
    >();

    for (const thread of [...currentThreads, ...staleThreads]) {
      const existing = byCommit.get(thread.commitSha);
      const comments = thread.messages.length;
      const updatedAt = thread.updatedAt || thread.createdAt || "";
      if (!existing) {
        byCommit.set(thread.commitSha, {
          commitSha: thread.commitSha,
          threads: 1,
          comments,
          latestUpdatedAt: updatedAt,
        });
        continue;
      }

      existing.threads += 1;
      existing.comments += comments;
      if (updatedAt && (!existing.latestUpdatedAt || updatedAt > existing.latestUpdatedAt)) {
        existing.latestUpdatedAt = updatedAt;
      }
    }

    return Array.from(byCommit.values()).sort((left, right) =>
      right.latestUpdatedAt.localeCompare(left.latestUpdatedAt)
    );
  }, [currentThreads, staleThreads]);

  const threadCommitShas = useMemo(
    () => commitStats.map((entry) => entry.commitSha),
    [commitStats]
  );

  async function refreshGitHubHistory(): Promise<void> {
    if (listCommitHistory) {
      setGithubLoading(true);
      setGithubError(null);
      try {
        const entries = await listCommitHistory(
          {},
          {
            host: typeof window === "undefined" ? "unknown" : window.location.host,
            pageKey,
            commitSha: currentCommitSha,
          }
        );
        setProviderCommitHistory(entries);
        setGithubCommits([]);
      } catch (error) {
        setProviderCommitHistory([]);
        setGithubError(error instanceof Error ? error.message : "Failed to load commit history.");
      } finally {
        setGithubLoading(false);
      }
      return;
    }

    if (typeof window === "undefined" || threadCommitShas.length === 0) {
      setGithubCommits([]);
      setProviderCommitHistory([]);
      setGithubError(null);
      setGithubLoading(false);
      return;
    }

    const token = resolveToken(githubToken);
    const mapping = parseHostConfig(githubHostConfig);
    const repoConfig = resolveRepoConfig(window.location.host, mapping);
    if (!token || !repoConfig) {
      setGithubCommits([]);
      setProviderCommitHistory([]);
      setGithubError(null);
      setGithubLoading(false);
      return;
    }

    setGithubLoading(true);
    setGithubError(null);
    try {
      const commits = await fetchCommitsForThreadShas({
        token,
        repo: repoConfig,
        commitShas: threadCommitShas,
        branch: githubBranch,
        branchesLimit: resolveBranchesLimit(githubBranchesLimit),
      });
      setGithubCommits(commits);
    } catch (error) {
      setGithubCommits([]);
      setGithubError(error instanceof Error ? error.message : "Failed to load GitHub commit history.");
    } finally {
      setGithubLoading(false);
    }
  }

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void refreshGitHubHistory();
  }, [
    enabled,
    pageKey,
    currentCommitSha,
    threadCommitShas.join(","),
    listCommitHistory,
    githubToken,
    githubHostConfig,
    githubBranch,
    githubBranchesLimit,
  ]);

  const commitHistory = useMemo(() => {
    if (providerCommitHistory.length > 0) {
      return providerCommitHistory.map((entry) => ({
        ...entry,
        branches: entry.branches || [],
      }));
    }

    const statsByCommit = new Map(commitStats.map((entry) => [entry.commitSha, entry]));
    const hasGitHubHistory = githubCommits.length > 0;
    if (!hasGitHubHistory) {
      return commitStats.map((entry) => ({
        commitSha: entry.commitSha,
        threads: entry.threads,
        comments: entry.comments,
        latestUpdatedAt: entry.latestUpdatedAt,
        message: "",
        htmlUrl: "",
        branches: [] as string[],
      }));
    }

    return githubCommits.map((entry) => {
      const stats = resolveStatsForCommit(entry.sha, statsByCommit);
      return {
        commitSha: entry.sha,
        threads: stats?.threads || 0,
        comments: stats?.comments || 0,
        latestUpdatedAt: entry.committedAt || stats?.latestUpdatedAt || "",
        message: entry.message,
        htmlUrl: entry.htmlUrl,
        branches: entry.branches,
      };
    });
  }, [commitStats, githubCommits, providerCommitHistory]);

  if (!enabled) {
    return null;
  }

  return (
    <div
      data-deshlo-annotation-ui="1"
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 10000,
        width,
        maxHeight: "80vh",
        overflowY: "auto",
        padding: 12,
        borderRadius: 10,
        border: "1px solid #0ea5e9",
        background: "rgba(17, 17, 17, 0.96)",
        color: "#f8fafc",
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Live Annotations</div>
      <div style={{ marginBottom: 8 }}>
        Hold {triggerKey.toUpperCase()} + click anywhere to create an annotation.
      </div>
      <div style={{ marginBottom: 8 }}>
        Plugin: <code>{pluginId}</code>
      </div>
      <div style={{ marginBottom: 8 }}>
        Page: <code>{pageKey}</code>
      </div>
      <div style={{ marginBottom: 8 }}>
        Runtime commit: <code>{currentCommitSha}</code>
      </div>
      <div style={{ marginBottom: 8 }}>
        Viewing commit: <code>{selectedCommitSha}</code>
        {selectedCommitSha !== currentCommitSha ? (
          <button
            onClick={() => {
              setSelectedCommitSha(currentCommitSha);
            }}
            style={{
              marginLeft: 8,
              padding: "2px 6px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: "transparent",
              color: "#f8fafc",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Use runtime
          </button>
        ) : null}
      </div>

      {readOnly ? (
        <div style={{ marginBottom: 8, color: "#fca5a5" }}>
          Read-only mode: current commit SHA is unknown, so creating new annotations is disabled.
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button
          onClick={() => {
            void Promise.all([refreshThreads(), refreshGitHubHistory()]);
          }}
          disabled={loading || githubLoading}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #334155",
            background: "transparent",
            color: "#f8fafc",
            cursor: loading || githubLoading ? "not-allowed" : "pointer",
          }}
        >
          {loading || githubLoading ? "Refreshing..." : "Refresh"}
        </button>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={showStale}
            onChange={(event) => {
              setShowStale(event.target.checked);
            }}
          />
          Show stale
        </label>
      </div>

      <div style={{ marginBottom: 8 }}>
        Current: <code>{currentThreads.length}</code> | Stale: <code>{staleThreads.length}</code>
      </div>
      <div style={{ opacity: 0.8, marginBottom: 8 }}>
        Thread actions are available directly on bubbles.
      </div>

      <div style={{ borderTop: "1px solid #334155", marginTop: 10, paddingTop: 8 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          Comment Commits (with branch info)
        </div>
        {githubError ? (
          <div style={{ marginBottom: 6, color: "#fca5a5" }}>{githubError}</div>
        ) : null}
        {githubCommits.length === 0 && providerCommitHistory.length === 0 && !githubLoading ? (
          <div style={{ marginBottom: 6, opacity: 0.8 }}>
            {listCommitHistory
              ? "Commit history unavailable, showing local thread commits."
              : "GitHub multi-branch history unavailable, showing local thread commits."}
          </div>
        ) : null}
        {commitHistory.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No commit history yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {commitHistory.map((entry) => (
              <div
                key={entry.commitSha}
                style={{
                  border:
                    entry.commitSha === selectedCommitSha
                      ? "1px solid #38bdf8"
                      : "1px solid #334155",
                  borderRadius: 8,
                  padding: 8,
                  background: "rgba(15, 23, 42, 0.5)",
                  cursor: "pointer",
                }}
                onClick={() => {
                  setSelectedCommitSha(entry.commitSha);
                }}
              >
                <div style={{ marginBottom: 4 }}>
                  {entry.htmlUrl ? (
                    <a
                      href={entry.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#93c5fd", textDecoration: "none" }}
                    >
                      <code>{entry.commitSha.slice(0, 12)}</code>
                    </a>
                  ) : (
                    <code>{entry.commitSha.slice(0, 12)}</code>
                  )}
                  {entry.commitSha === currentCommitSha ? (
                    <span style={{ marginLeft: 6, color: "#38bdf8" }}>(current)</span>
                  ) : null}
                  {entry.commitSha === selectedCommitSha ? (
                    <span style={{ marginLeft: 6, color: "#22c55e" }}>(viewing)</span>
                  ) : null}
                </div>
                {entry.message ? (
                  <div style={{ opacity: 0.9, marginBottom: 4 }}>{entry.message}</div>
                ) : null}
                {entry.branches.length > 0 ? (
                  <div style={{ opacity: 0.85, marginBottom: 4 }}>
                    Branches: <code>{entry.branches.join(", ")}</code>
                  </div>
                ) : null}
                <div style={{ opacity: 0.85 }}>
                  Threads: <code>{entry.threads}</code> | Comments: <code>{entry.comments}</code>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {result ? (
        <div
          style={{
            borderTop: "1px solid #334155",
            marginTop: 10,
            paddingTop: 8,
            color: result.ok ? "#86efac" : "#fca5a5",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{result.ok ? "Success" : "Error"}</div>
          <div>{result.message}</div>
          {result.links && result.links.length > 0 ? (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              {result.links.map((link: AnnotationResultLink) => (
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
