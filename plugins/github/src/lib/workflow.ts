import { SourceInspectorError } from "./errors";
import { createGitHubProvider, type RepoProvider } from "./githubProvider";
import {
  resolveRepoConfigForCurrentHost,
  type HostConfigInput,
} from "./hostConfig";
import { applyTextReplacement } from "./jsxTextEdit";
import { parseSourceLoc } from "./sourceLoc";
import type {
  BranchesSuccess,
  CreateDraftPrSuccess,
  PreviewChangeSuccess,
  ProposedChangeInput,
} from "./types";

function normalizeRepoPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\/+/, "");
}

function resolveGitHubFilePath(sourceFilePath: string, prefixOverride?: string): string {
  const normalizedSourcePath = normalizeRepoPath(sourceFilePath);
  const rawPrefix =
    prefixOverride?.trim() || process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_GITHUB_PATH_PREFIX?.trim() || "";
  const normalizedPrefix = rawPrefix
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  if (!normalizedPrefix) {
    return normalizedSourcePath;
  }

  if (
    normalizedSourcePath === normalizedPrefix ||
    normalizedSourcePath.startsWith(`${normalizedPrefix}/`)
  ) {
    return normalizedSourcePath;
  }

  return `${normalizedPrefix}/${normalizedSourcePath}`;
}

function slugifyTag(tagName: string): string {
  return (
    tagName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "element"
  );
}

function generateBranchName(tagName: string, prefixOverride?: string): string {
  const prefix =
    prefixOverride?.trim() ||
    process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_BRANCH_PREFIX ||
    "source-inspector";
  const timestamp = Date.now();
  const slug = slugifyTag(tagName);
  return `${prefix}/${slug}-${timestamp}`;
}

function assertValidInput(input: ProposedChangeInput): void {
  if (!input.tagName?.trim()) {
    throw new SourceInspectorError("INVALID_SOURCE_LOC", "tagName is required.");
  }

  if (!input.sourceLoc?.trim()) {
    throw new SourceInspectorError("INVALID_SOURCE_LOC", "sourceLoc is required.");
  }

  if (!input.baseBranch?.trim()) {
    throw new SourceInspectorError("BASE_BRANCH_NOT_FOUND", "baseBranch is required.");
  }

  if (!input.selectedText?.trim()) {
    throw new SourceInspectorError(
      "NON_TEXT_NODE",
      "Selected element does not contain direct text. Select a text element."
    );
  }

  if (!input.proposedText?.trim()) {
    throw new SourceInspectorError("NO_DIFF", "Proposed changes cannot be empty.");
  }
}

export interface ClientRuntimeContext {
  token: string;
  runtime?: SourceInspectorRuntimeOptions;
}

export interface SourceInspectorRuntimeOptions {
  host?: string;
  hostConfig?: HostConfigInput;
  githubPathPrefix?: string;
  branchPrefix?: string;
}

function createProviderFromContext(context: ClientRuntimeContext): RepoProvider {
  const token = context.token.trim();
  if (!token) {
    throw new SourceInspectorError("AUTH_REQUIRED", "GitHub token is required.");
  }

  const repoConfig = resolveRepoConfigForCurrentHost(
    context.runtime?.host,
    context.runtime?.hostConfig
  );
  return createGitHubProvider(repoConfig, token);
}

export async function getBranches(context: ClientRuntimeContext): Promise<BranchesSuccess> {
  const repoConfig = resolveRepoConfigForCurrentHost(
    context.runtime?.host,
    context.runtime?.hostConfig
  );
  const provider = createGitHubProvider(repoConfig, context.token);

  const branches = await provider.listBranches();
  if (branches.length === 0) {
    throw new SourceInspectorError("BASE_BRANCH_NOT_FOUND", "Repository has no branches.");
  }

  const fallback = branches.includes("main") ? "main" : branches[0];

  return {
    branches,
    defaultBaseBranch: repoConfig.defaultBaseBranch || fallback,
  };
}

async function buildPreview(
  input: ProposedChangeInput,
  provider: RepoProvider,
  runtime?: SourceInspectorRuntimeOptions
): Promise<{ preview: PreviewChangeSuccess; updatedSourceCode: string }> {
  assertValidInput(input);

  const parsedSourceLoc = parseSourceLoc(input.sourceLoc);
  const repoFilePath = resolveGitHubFilePath(parsedSourceLoc.filePath, runtime?.githubPathPrefix);
  await provider.getBranchHeadSha(input.baseBranch);
  const file = await provider.getFileContent(repoFilePath, input.baseBranch);

  const replacement = applyTextReplacement({
    sourceCode: file.content,
    sourceLoc: parsedSourceLoc,
    tagName: input.tagName,
    selectedText: input.selectedText,
    proposedText: input.proposedText,
  });

  return {
    preview: {
      filePath: repoFilePath,
      oldText: replacement.oldText,
      newText: replacement.newText,
      line: parsedSourceLoc.line,
      column: parsedSourceLoc.column,
      tagName: input.tagName,
      branchNamePreview: generateBranchName(input.tagName, runtime?.branchPrefix),
    },
    updatedSourceCode: replacement.updatedSourceCode,
  };
}

export async function previewProposedChangeWithProvider(
  input: ProposedChangeInput,
  provider: RepoProvider,
  runtime?: SourceInspectorRuntimeOptions
): Promise<PreviewChangeSuccess> {
  const { preview } = await buildPreview(input, provider, runtime);
  return preview;
}

function buildPrBody(params: {
  sourceLoc: string;
  oldText: string;
  newText: string;
  baseBranch: string;
  commitSha?: string;
}): string {
  const lines = [
    "This draft PR was generated by Source Inspector.",
    "",
    `- Source location: \`${params.sourceLoc}\``,
    `- Base branch: \`${params.baseBranch}\``,
    `- Old text: \`${params.oldText}\``,
    `- New text: \`${params.newText}\``,
  ];

  if (params.commitSha && params.commitSha !== "unknown") {
    lines.push(`- Build commit: \`${params.commitSha}\``);
  }

  return lines.join("\n");
}

export async function createDraftPrFromProposedChangeWithProvider(
  input: ProposedChangeInput,
  provider: RepoProvider,
  runtime?: SourceInspectorRuntimeOptions
): Promise<CreateDraftPrSuccess> {
  const { preview, updatedSourceCode } = await buildPreview(input, provider, runtime);
  const branchName = generateBranchName(input.tagName, runtime?.branchPrefix);

  const baseSha = await provider.getBranchHeadSha(input.baseBranch);
  await provider.createBranch(branchName, baseSha);

  const currentFile = await provider.getFileContent(preview.filePath, input.baseBranch);
  const commitMessage = `Source Inspector: update ${preview.tagName} text in ${preview.filePath}`;

  const commit = await provider.updateFile({
    path: preview.filePath,
    branch: branchName,
    sha: currentFile.sha,
    content: updatedSourceCode,
    message: commitMessage,
  });

  const prTitle = `Source Inspector: update ${preview.tagName} text in ${preview.filePath}`;
  const prBody = buildPrBody({
    sourceLoc: input.sourceLoc,
    oldText: preview.oldText,
    newText: preview.newText,
    baseBranch: input.baseBranch,
    commitSha: input.commitSha,
  });

  const pr = await provider.createDraftPullRequest({
    title: prTitle,
    body: prBody,
    head: branchName,
    base: input.baseBranch,
  });

  return {
    branchName,
    commitSha: commit.commitSha,
    prNumber: pr.prNumber,
    prUrl: pr.prUrl,
  };
}

export async function previewProposedChange(
  input: ProposedChangeInput,
  context: ClientRuntimeContext
): Promise<PreviewChangeSuccess> {
  const provider = createProviderFromContext(context);
  return previewProposedChangeWithProvider(input, provider, context.runtime);
}

export async function createDraftPrFromProposedChange(
  input: ProposedChangeInput,
  context: ClientRuntimeContext
): Promise<CreateDraftPrSuccess> {
  const provider = createProviderFromContext(context);
  return createDraftPrFromProposedChangeWithProvider(input, provider, context.runtime);
}
