import { execSync } from "node:child_process";
import type { Metadata } from "next";
import { AnnotationGate, HttpAnnotationsPlugin, type HttpAnnotationsPluginConfig } from "@deshlo/annotations";
import { OverlayGate, GithubPlugin, type GitHubBrowserPluginConfig } from "deshlo";

import "./globals.css";

export const metadata: Metadata = {
  title: "Source Inspector Test App",
  description: "App Router playground for @deshlo/nextjs",
};

const COMMIT_ENV_KEYS = [
  "NEXT_PUBLIC_DESHLO_COMMIT_SHA",
  "DESHLO_COMMIT_SHA",
  "COMMIT_SHA",
  "SOURCE_VERSION",
  "GITHUB_SHA",
  "CI_COMMIT_SHA",
  "GIT_COMMIT",
  "VERCEL_GIT_COMMIT_SHA",
  "RENDER_GIT_COMMIT",
] as const;

let cachedCommitSha: string | null = null;

function resolveGlobalCommitSha(): string {
  const shouldCache = process.env.NODE_ENV === "production";
  if (shouldCache && cachedCommitSha) {
    return cachedCommitSha;
  }

  for (const key of COMMIT_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      if (shouldCache) {
        cachedCommitSha = value;
      }
      return value;
    }
  }

  try {
    const value = execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (value) {
      if (shouldCache) {
        cachedCommitSha = value;
      }
      return value;
    }
  } catch {
    // no-op
  }

  return "unknown";
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const commitSha = resolveGlobalCommitSha();
  const sourceInspectorEnabled = process.env.NEXT_PUBLIC_SOURCE_INSPECTOR === "1";
  const annotationsEnabled = process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS === "1";
  const annotationsApiBaseUrl =
    process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_API_BASE_URL ||
    process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_BASE_URL ||
    "http://localhost:8080";
  const annotationsApiKey = process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_API_KEY || "";
  const environment = process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_ENVIRONMENT;
  const annotationsGithubToken =
    process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_GITHUB_TOKEN ||
    process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    "";
  const annotationsGithubHostConfig =
    process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_HOST_CONFIG ||
    process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_HOST_CONFIG ||
    process.env.SOURCE_INSPECTOR_HOST_CONFIG;
  const annotationsGithubBranch = process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_GITHUB_BRANCH;
  const annotationsGithubBranchesLimitRaw =
    process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_GITHUB_BRANCHES_LIMIT;
  const annotationsGithubBranchesLimit =
    annotationsGithubBranchesLimitRaw && Number.isFinite(Number(annotationsGithubBranchesLimitRaw))
      ? Number(annotationsGithubBranchesLimitRaw)
      : undefined;

  const githubToken =
    process.env.GITHUB_TOKEN || process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_GITHUB_TOKEN;
  const hostConfig =
    process.env.SOURCE_INSPECTOR_HOST_CONFIG ||
    process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_HOST_CONFIG;
  const branchPrefix =
    process.env.SOURCE_INSPECTOR_BRANCH_PREFIX ||
    process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_BRANCH_PREFIX;
  const annotationsConfig = {
    apiBaseUrl: annotationsApiBaseUrl,
    apiKey: annotationsApiKey,
    environment,
  } satisfies HttpAnnotationsPluginConfig;

  const sourceInspectorConfig = {
    token: githubToken,
    hostConfig,
    branchPrefix,
  } satisfies GitHubBrowserPluginConfig;

  return (
    <html lang="en">
      <body data-deshlo-commit={commitSha}>
        {annotationsEnabled ? (
          <HttpAnnotationsPlugin config={annotationsConfig}>
            <AnnotationGate
              enabled
              commitSha={commitSha}
              githubToken={annotationsGithubToken}
              githubHostConfig={annotationsGithubHostConfig}
              githubBranch={annotationsGithubBranch}
              githubBranchesLimit={annotationsGithubBranchesLimit}
            />
          </HttpAnnotationsPlugin>
        ) : sourceInspectorEnabled ? (
          <GithubPlugin config={sourceInspectorConfig}>
            <OverlayGate enabled commitSha={commitSha} />
          </GithubPlugin>
        ) : null}
        {children}
      </body>
    </html>
  );
}
