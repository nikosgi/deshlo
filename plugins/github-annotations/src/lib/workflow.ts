import type {
  AnnotationActionResult,
  AnnotationCreateThreadInput,
  AnnotationListThreadsInput,
  AnnotationMessage,
  AnnotationPluginContext,
  AnnotationReplyThreadInput,
  AnnotationThread,
  AnnotationThreadActionInput,
} from "@deshlo/core/annotations";

import { AnnotationProviderError } from "./errors";
import { createGitHubProvider, type RepoProvider } from "./githubProvider";
import {
  resolveRepoConfigForCurrentHost,
  type HostConfigInput,
  type ResolvedRepoConfig,
} from "./hostConfig";
import {
  appendThreadMessage,
  createManagedAnnotationsState,
  listThreadsFromState,
  parseManagedAnnotationsState,
  setThreadStatus,
  upsertThread,
  writeManagedAnnotationsState,
} from "./prState";

export interface GitHubAnnotationsRuntimeOptions {
  host?: string;
  hostConfig?: HostConfigInput;
  baseBranch?: string;
  branchPrefix?: string;
  projectId?: string;
  environment?: string;
}

export interface ClientRuntimeContext {
  token: string;
  runtime?: GitHubAnnotationsRuntimeOptions;
}

interface ManagedPrMatch {
  prNumber: number;
  prUrl: string;
  body: string;
  baseBranch: string;
  headBranch: string;
  commitSha: string;
}

function hasKnownCommitSha(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && normalized !== "unknown";
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function shortCommit(commitSha: string): string {
  return commitSha.slice(0, 7);
}

function generateThreadId(commitSha: string): string {
  return `thread-${shortCommit(commitSha)}-${Date.now()}`;
}

function generateMessageId(threadId: string): string {
  return `${threadId}-msg-${Date.now()}`;
}

function generateBranchName(commitSha: string, prefixOverride?: string): string {
  const prefix =
    prefixOverride?.trim() || process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_BRANCH_PREFIX || "deshlo-annotations";
  return `${prefix}/${shortCommit(commitSha)}-${Date.now()}`;
}

function toResultLinks(prNumber: number, prUrl: string) {
  return [
    {
      label: `Open PR #${prNumber}`,
      url: prUrl,
    },
  ];
}

function resolveBaseBranch(config: ResolvedRepoConfig, runtime?: GitHubAnnotationsRuntimeOptions): string {
  return runtime?.baseBranch || config.defaultBaseBranch || "main";
}

function resolveProvider(context: ClientRuntimeContext, pluginContext: AnnotationPluginContext): {
  provider: RepoProvider;
  config: ResolvedRepoConfig;
} {
  const token = context.token.trim();
  if (!token) {
    throw new AnnotationProviderError("AUTH_REQUIRED", "GitHub token is required.");
  }

  const config = resolveRepoConfigForCurrentHost(
    context.runtime?.host || pluginContext.host,
    context.runtime?.hostConfig
  );

  return {
    config,
    provider: createGitHubProvider(config, token),
  };
}

async function findManagedPrForCommit(
  provider: RepoProvider,
  commitSha: string
): Promise<ManagedPrMatch | null> {
  const openPrs = await provider.listOpenPullRequests();

  for (const pr of openPrs) {
    if (!pr.draft) {
      continue;
    }

    const state = parseManagedAnnotationsState(pr.body);
    if (!state || state.commitSha !== commitSha) {
      continue;
    }

    return {
      prNumber: pr.prNumber,
      prUrl: pr.prUrl,
      body: pr.body,
      baseBranch: pr.baseBranch,
      headBranch: pr.headBranch,
      commitSha: state.commitSha,
    };
  }

  return null;
}

function findThreadPageKey(
  body: string,
  input: Pick<AnnotationThreadActionInput | AnnotationReplyThreadInput, "threadId" | "pageKey">
): string | null {
  const state = parseManagedAnnotationsState(body);
  if (!state) {
    return null;
  }

  const preferredPage = state.pages[input.pageKey];
  if (preferredPage && preferredPage.threads.some((thread) => thread.threadId === input.threadId)) {
    return input.pageKey;
  }

  for (const page of Object.values(state.pages)) {
    if (page.threads.some((thread) => thread.threadId === input.threadId)) {
      return page.pageKey;
    }
  }

  return null;
}

async function findManagedPrForThread(
  provider: RepoProvider,
  input: Pick<AnnotationThreadActionInput | AnnotationReplyThreadInput, "commitSha" | "threadId" | "pageKey">
): Promise<(ManagedPrMatch & { resolvedPageKey: string }) | null> {
  const openPrs = await provider.listOpenPullRequests();

  for (const pr of openPrs) {
    if (!pr.draft) {
      continue;
    }

    const state = parseManagedAnnotationsState(pr.body);
    if (!state || state.commitSha !== input.commitSha) {
      continue;
    }

    const resolvedPageKey = findThreadPageKey(pr.body, input);
    if (!resolvedPageKey) {
      continue;
    }

    return {
      prNumber: pr.prNumber,
      prUrl: pr.prUrl,
      body: pr.body,
      baseBranch: pr.baseBranch,
      headBranch: pr.headBranch,
      commitSha: state.commitSha,
      resolvedPageKey,
    };
  }

  return null;
}

function buildThread(input: AnnotationCreateThreadInput, runtime?: GitHubAnnotationsRuntimeOptions): AnnotationThread {
  const now = toIsoNow();
  const threadId = generateThreadId(input.commitSha);

  return {
    threadId,
    projectId: input.projectId || runtime?.projectId,
    environment: input.environment || runtime?.environment,
    pageKey: input.pageKey,
    commitSha: input.commitSha,
    status: "open",
    anchor: input.anchor,
    messages: [
      {
        messageId: generateMessageId(threadId),
        body: input.body,
        author: input.author,
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

async function createManagedPrForCommit(params: {
  provider: RepoProvider;
  config: ResolvedRepoConfig;
  runtime?: GitHubAnnotationsRuntimeOptions;
  commitSha: string;
  initialStateBody: string;
}): Promise<{ prNumber: number; prUrl: string; branchName: string; baseBranch: string }> {
  const baseBranch = resolveBaseBranch(params.config, params.runtime);
  const baseHeadSha = await params.provider.getBranchHeadSha(baseBranch);
  const branchName = generateBranchName(params.commitSha, params.runtime?.branchPrefix);

  await params.provider.createBranch(branchName, baseHeadSha);

  // Create an empty commit so GitHub allows opening a PR without file changes.
  const treeSha = await params.provider.getCommitTreeSha(baseHeadSha);
  const commitSha = await params.provider.createCommit({
    message: `chore: initialize deshlo annotations for ${shortCommit(params.commitSha)}`,
    treeSha,
    parentCommitSha: baseHeadSha,
  });

  await params.provider.updateBranchHead({
    branch: branchName,
    commitSha,
  });

  const pr = await params.provider.createDraftPullRequest({
    title: `Deshlo annotations for ${shortCommit(params.commitSha)}`,
    body: params.initialStateBody,
    head: branchName,
    base: baseBranch,
  });

  return {
    prNumber: pr.prNumber,
    prUrl: pr.prUrl,
    branchName,
    baseBranch,
  };
}

export async function listThreadsWithProvider(
  input: AnnotationListThreadsInput,
  pluginContext: AnnotationPluginContext,
  provider: RepoProvider
): Promise<AnnotationThread[]> {
  const openPrs = await provider.listOpenPullRequests();
  const allThreads: AnnotationThread[] = [];

  for (const pr of openPrs) {
    if (!pr.draft) {
      continue;
    }

    const state = parseManagedAnnotationsState(pr.body);
    if (!state) {
      continue;
    }

    const pageThreads = listThreadsFromState(state, pluginContext.pageKey);

    for (const thread of pageThreads) {
      if (!input.includeStale && thread.commitSha !== pluginContext.commitSha) {
        continue;
      }
      allThreads.push(thread);
    }
  }

  return allThreads.sort((left, right) => {
    const leftMs = Date.parse(left.updatedAt) || 0;
    const rightMs = Date.parse(right.updatedAt) || 0;
    return rightMs - leftMs;
  });
}

export async function createThreadWithProvider(
  input: AnnotationCreateThreadInput,
  pluginContext: AnnotationPluginContext,
  provider: RepoProvider,
  config: ResolvedRepoConfig,
  runtime?: GitHubAnnotationsRuntimeOptions
): Promise<AnnotationActionResult> {
  if (!hasKnownCommitSha(input.commitSha)) {
    throw new AnnotationProviderError("UNKNOWN_COMMIT", "Commit SHA is required to create annotations.");
  }

  const thread = buildThread(input, runtime);
  const updatedAt = toIsoNow();

  const existing = await findManagedPrForCommit(provider, input.commitSha);
  if (existing) {
    const parsedState = parseManagedAnnotationsState(existing.body);
    const state = parsedState || createManagedAnnotationsState(input.commitSha, thread, updatedAt);
    const nextState = upsertThread(state, thread, updatedAt);
    const nextBody = writeManagedAnnotationsState(existing.body, nextState);

    await provider.updatePullRequestBody(existing.prNumber, nextBody);

    return {
      ok: true,
      message: `Thread created in draft PR #${existing.prNumber}.`,
      links: toResultLinks(existing.prNumber, existing.prUrl),
    };
  }

  const initialState = createManagedAnnotationsState(input.commitSha, thread, updatedAt);
  const initialBody = writeManagedAnnotationsState("", initialState);

  const created = await createManagedPrForCommit({
    provider,
    config,
    runtime,
    commitSha: input.commitSha,
    initialStateBody: initialBody,
  });

  return {
    ok: true,
    message: `Thread created in draft PR #${created.prNumber}.`,
    links: toResultLinks(created.prNumber, created.prUrl),
  };
}

function buildReplyMessage(input: AnnotationReplyThreadInput): AnnotationMessage {
  return {
    messageId: generateMessageId(input.threadId),
    body: input.body,
    author: input.author,
    createdAt: toIsoNow(),
  };
}

async function getManagedStateForThread(
  provider: RepoProvider,
  input: AnnotationThreadActionInput | AnnotationReplyThreadInput
): Promise<{ pr: ManagedPrMatch; body: string; pageKey: string }> {
  if (!hasKnownCommitSha(input.commitSha)) {
    throw new AnnotationProviderError("UNKNOWN_COMMIT", "Commit SHA is required.");
  }

  const existing = await findManagedPrForThread(provider, input);
  if (!existing) {
    throw new AnnotationProviderError("THREAD_NOT_FOUND", `Thread ${input.threadId} was not found.`);
  }

  return {
    pr: existing,
    body: existing.body,
    pageKey: existing.resolvedPageKey,
  };
}

export async function replyThreadWithProvider(
  input: AnnotationReplyThreadInput,
  provider: RepoProvider
): Promise<AnnotationActionResult> {
  const match = await getManagedStateForThread(provider, input);
  const state = parseManagedAnnotationsState(match.body);
  if (!state) {
    throw new AnnotationProviderError("THREAD_NOT_FOUND", `Thread ${input.threadId} was not found.`);
  }

  const nextState = appendThreadMessage(state, {
    pageKey: match.pageKey,
    threadId: input.threadId,
    message: buildReplyMessage(input),
    updatedAt: toIsoNow(),
  });

  if (!nextState) {
    throw new AnnotationProviderError("THREAD_NOT_FOUND", `Thread ${input.threadId} was not found.`);
  }

  const nextBody = writeManagedAnnotationsState(match.body, nextState);
  await provider.updatePullRequestBody(match.pr.prNumber, nextBody);

  return {
    ok: true,
    message: `Reply added to thread ${input.threadId}.`,
    links: toResultLinks(match.pr.prNumber, match.pr.prUrl),
  };
}

export async function setThreadStatusWithProvider(
  input: AnnotationThreadActionInput,
  status: "open" | "resolved",
  provider: RepoProvider
): Promise<AnnotationActionResult> {
  const match = await getManagedStateForThread(provider, input);
  const state = parseManagedAnnotationsState(match.body);
  if (!state) {
    throw new AnnotationProviderError("THREAD_NOT_FOUND", `Thread ${input.threadId} was not found.`);
  }

  const nextState = setThreadStatus(state, {
    pageKey: match.pageKey,
    threadId: input.threadId,
    status,
    updatedAt: toIsoNow(),
  });

  if (!nextState) {
    throw new AnnotationProviderError("THREAD_NOT_FOUND", `Thread ${input.threadId} was not found.`);
  }

  const nextBody = writeManagedAnnotationsState(match.body, nextState);
  await provider.updatePullRequestBody(match.pr.prNumber, nextBody);

  return {
    ok: true,
    message:
      status === "resolved"
        ? `Thread ${input.threadId} resolved.`
        : `Thread ${input.threadId} reopened.`,
    links: toResultLinks(match.pr.prNumber, match.pr.prUrl),
  };
}

export async function listThreads(
  input: AnnotationListThreadsInput,
  pluginContext: AnnotationPluginContext,
  clientContext: ClientRuntimeContext
): Promise<AnnotationThread[]> {
  const { provider } = resolveProvider(clientContext, pluginContext);
  return listThreadsWithProvider(input, pluginContext, provider);
}

export async function createThread(
  input: AnnotationCreateThreadInput,
  pluginContext: AnnotationPluginContext,
  clientContext: ClientRuntimeContext
): Promise<AnnotationActionResult> {
  const { provider, config } = resolveProvider(clientContext, pluginContext);
  return createThreadWithProvider(input, pluginContext, provider, config, clientContext.runtime);
}

export async function replyThread(
  input: AnnotationReplyThreadInput,
  pluginContext: AnnotationPluginContext,
  clientContext: ClientRuntimeContext
): Promise<AnnotationActionResult> {
  const { provider } = resolveProvider(clientContext, pluginContext);
  return replyThreadWithProvider(input, provider);
}

export async function resolveThread(
  input: AnnotationThreadActionInput,
  pluginContext: AnnotationPluginContext,
  clientContext: ClientRuntimeContext
): Promise<AnnotationActionResult> {
  const { provider } = resolveProvider(clientContext, pluginContext);
  return setThreadStatusWithProvider(input, "resolved", provider);
}

export async function reopenThread(
  input: AnnotationThreadActionInput,
  pluginContext: AnnotationPluginContext,
  clientContext: ClientRuntimeContext
): Promise<AnnotationActionResult> {
  const { provider } = resolveProvider(clientContext, pluginContext);
  return setThreadStatusWithProvider(input, "open", provider);
}
