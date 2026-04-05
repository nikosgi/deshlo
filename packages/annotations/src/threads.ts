import type { AnnotationThread } from "./annotation-plugin";

export interface AnnotationThreadGroups {
  current: AnnotationThread[];
  stale: AnnotationThread[];
}

export function sortThreadsByUpdatedDesc(threads: AnnotationThread[]): AnnotationThread[] {
  return [...threads].sort((left, right) => {
    const leftMs = Date.parse(left.updatedAt) || 0;
    const rightMs = Date.parse(right.updatedAt) || 0;
    return rightMs - leftMs;
  });
}

export function groupThreadsByRevision(
  threads: AnnotationThread[],
  currentCommitSha: string
): AnnotationThreadGroups {
  if (!currentCommitSha || currentCommitSha === "unknown") {
    return {
      current: [],
      stale: sortThreadsByUpdatedDesc(threads),
    };
  }

  const current = threads.filter((thread) => thread.commitSha === currentCommitSha);
  const stale = threads.filter((thread) => thread.commitSha !== currentCommitSha);

  return {
    current: sortThreadsByUpdatedDesc(current),
    stale: sortThreadsByUpdatedDesc(stale),
  };
}
