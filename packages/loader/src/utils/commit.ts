import { execSync } from "node:child_process";

const COMMIT_ENV_KEYS = [
  "COMMIT_SHA",
  "SOURCE_VERSION",
  "GITHUB_SHA",
  "CI_COMMIT_SHA",
  "GIT_COMMIT",
  "VERCEL_GIT_COMMIT_SHA",
  "RENDER_GIT_COMMIT",
] as const;

let cachedCommitSha: string | null = null;

function resolveCommitFromEnv(): string | null {
  for (const key of COMMIT_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function resolveCommitFromGit(): string | null {
  try {
    const value = execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function resolveBuildCommitSha(): string {
  const shouldCache = process.env.NODE_ENV === "production";

  if (shouldCache && cachedCommitSha) {
    return cachedCommitSha;
  }

  const resolved =
    resolveCommitFromEnv() ??
    resolveCommitFromGit() ??
    "unknown";

  if (shouldCache) {
    cachedCommitSha = resolved;
  }
  return resolved;
}
