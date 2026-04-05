import type { AnnotationMessage, AnnotationThread, AnnotationThreadStatus } from "@deshlo/core/annotations";

export const DESHLO_ANNOTATIONS_STATE_START = "<!-- deshlo:annotations:start";
export const DESHLO_ANNOTATIONS_STATE_END = "deshlo:annotations:end -->";

const MANAGED_BY = "deshlo/annotations";
const STATE_VERSION = 1;

export interface ManagedAnnotationsPageState {
  pageKey: string;
  threads: AnnotationThread[];
}

export interface ManagedAnnotationsState {
  version: number;
  managedBy: string;
  commitSha: string;
  pages: Record<string, ManagedAnnotationsPageState>;
  updatedAt: string;
}

interface MarkerRange {
  start: number;
  end: number;
  jsonStartOffset: number;
  jsonEndOffset: number;
}

function findMarkerRange(body: string): MarkerRange | null {
  const start = body.indexOf(DESHLO_ANNOTATIONS_STATE_START);
  if (start < 0) {
    return null;
  }

  const end = body.indexOf(DESHLO_ANNOTATIONS_STATE_END, start + DESHLO_ANNOTATIONS_STATE_START.length);
  if (end < 0) {
    return null;
  }

  return {
    start,
    end: end + DESHLO_ANNOTATIONS_STATE_END.length,
    jsonStartOffset: start + DESHLO_ANNOTATIONS_STATE_START.length,
    jsonEndOffset: end,
  };
}

function getStateJson(body: string): string | null {
  const range = findMarkerRange(body);
  if (!range) {
    return null;
  }

  const json = body.slice(range.jsonStartOffset, range.jsonEndOffset).trim();
  return json || null;
}

function isMessage(value: unknown): value is AnnotationMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AnnotationMessage>;
  return (
    typeof candidate.messageId === "string" &&
    candidate.messageId.length > 0 &&
    typeof candidate.body === "string" &&
    candidate.body.length > 0 &&
    typeof candidate.createdAt === "string" &&
    candidate.createdAt.length > 0
  );
}

function isThread(value: unknown): value is AnnotationThread {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AnnotationThread>;
  return (
    typeof candidate.threadId === "string" &&
    typeof candidate.pageKey === "string" &&
    typeof candidate.commitSha === "string" &&
    (candidate.status === "open" || candidate.status === "resolved") &&
    Array.isArray(candidate.messages) &&
    candidate.messages.every(isMessage) &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    Boolean(candidate.anchor)
  );
}

function isState(value: unknown): value is ManagedAnnotationsState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ManagedAnnotationsState>;
  if (
    candidate.version !== STATE_VERSION ||
    candidate.managedBy !== MANAGED_BY ||
    typeof candidate.commitSha !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    !candidate.pages ||
    typeof candidate.pages !== "object"
  ) {
    return false;
  }

  const pages = Object.values(candidate.pages as Record<string, ManagedAnnotationsPageState>);
  return pages.every(
    (page) =>
      page &&
      typeof page.pageKey === "string" &&
      Array.isArray(page.threads) &&
      page.threads.every(isThread)
  );
}

function buildVisibleSummary(state: ManagedAnnotationsState): string {
  const pageCount = Object.keys(state.pages).length;
  const threadCount = Object.values(state.pages).reduce(
    (count, page) => count + page.threads.length,
    0
  );

  return [
    "This draft PR is managed by Deshlo live annotations.",
    "",
    `- Commit: \`${state.commitSha}\``,
    `- Pages: ${pageCount}`,
    `- Threads: ${threadCount}`,
  ].join("\n");
}

function buildStateBlock(state: ManagedAnnotationsState): string {
  return `<!-- deshlo:annotations:start\n${JSON.stringify(state, null, 2)}\ndeshlo:annotations:end -->`;
}

export function createManagedAnnotationsState(
  commitSha: string,
  thread: AnnotationThread,
  updatedAt: string
): ManagedAnnotationsState {
  return {
    version: STATE_VERSION,
    managedBy: MANAGED_BY,
    commitSha,
    pages: {
      [thread.pageKey]: {
        pageKey: thread.pageKey,
        threads: [thread],
      },
    },
    updatedAt,
  };
}

export function parseManagedAnnotationsState(body: string | null | undefined): ManagedAnnotationsState | null {
  if (!body) {
    return null;
  }

  const json = getStateJson(body);
  if (!json) {
    return null;
  }

  try {
    const parsed = JSON.parse(json);
    return isState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeManagedAnnotationsState(
  body: string | null | undefined,
  state: ManagedAnnotationsState
): string {
  const summary = buildVisibleSummary(state);
  const stateBlock = buildStateBlock(state);
  const nextBody = `${summary}\n\n${stateBlock}`;

  const existing = body?.trim();
  if (!existing) {
    return nextBody;
  }

  const range = findMarkerRange(existing);
  if (!range) {
    return `${existing}\n\n${stateBlock}`;
  }

  const before = existing.slice(0, range.start).trim();
  if (!before) {
    return nextBody;
  }

  return `${before}\n\n${stateBlock}`;
}

function upsertThreadInPage(page: ManagedAnnotationsPageState, thread: AnnotationThread): ManagedAnnotationsPageState {
  const remaining = page.threads.filter((entry) => entry.threadId !== thread.threadId);
  remaining.push(thread);

  return {
    ...page,
    threads: remaining,
  };
}

export function upsertThread(
  state: ManagedAnnotationsState,
  thread: AnnotationThread,
  updatedAt: string
): ManagedAnnotationsState {
  const page = state.pages[thread.pageKey] || {
    pageKey: thread.pageKey,
    threads: [],
  };

  return {
    ...state,
    pages: {
      ...state.pages,
      [thread.pageKey]: upsertThreadInPage(page, thread),
    },
    updatedAt,
  };
}

function findThread(
  state: ManagedAnnotationsState,
  pageKey: string,
  threadId: string
): AnnotationThread | null {
  const page = state.pages[pageKey];
  if (!page) {
    return null;
  }

  return page.threads.find((thread) => thread.threadId === threadId) || null;
}

export function appendThreadMessage(
  state: ManagedAnnotationsState,
  input: {
    pageKey: string;
    threadId: string;
    message: AnnotationMessage;
    updatedAt: string;
  }
): ManagedAnnotationsState | null {
  const existing = findThread(state, input.pageKey, input.threadId);
  if (!existing) {
    return null;
  }

  const updated: AnnotationThread = {
    ...existing,
    messages: [...existing.messages, input.message],
    updatedAt: input.updatedAt,
  };

  return upsertThread(state, updated, input.updatedAt);
}

export function setThreadStatus(
  state: ManagedAnnotationsState,
  input: {
    pageKey: string;
    threadId: string;
    status: AnnotationThreadStatus;
    updatedAt: string;
  }
): ManagedAnnotationsState | null {
  const existing = findThread(state, input.pageKey, input.threadId);
  if (!existing) {
    return null;
  }

  const updated: AnnotationThread = {
    ...existing,
    status: input.status,
    updatedAt: input.updatedAt,
  };

  return upsertThread(state, updated, input.updatedAt);
}

export function listThreadsFromState(state: ManagedAnnotationsState, pageKey: string): AnnotationThread[] {
  const page = state.pages[pageKey];
  if (!page) {
    return [];
  }

  return [...page.threads];
}
