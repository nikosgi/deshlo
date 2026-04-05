import type { OverlayBatchSubmitInput } from "./overlay-plugin";
import type { OverlayStagedChange } from "./source-inspector-context";

export function upsertStagedChanges(
  previous: OverlayStagedChange[],
  next: OverlayStagedChange
): OverlayStagedChange[] {
  const filtered = previous.filter((change) => change.sourceLoc !== next.sourceLoc);
  filtered.push(next);
  return filtered;
}

export function removeStagedChangeBySourceLoc(
  previous: OverlayStagedChange[],
  sourceLoc: string
): OverlayStagedChange[] {
  return previous.filter((change) => change.sourceLoc !== sourceLoc);
}

export function updateStagedChangeProposedText(
  previous: OverlayStagedChange[],
  sourceLoc: string,
  proposedText: string
): OverlayStagedChange[] {
  return previous.map((change) =>
    change.sourceLoc === sourceLoc
      ? {
          ...change,
          proposedText,
        }
      : change
  );
}

export function hasMixedKnownRevisions(stagedChanges: OverlayStagedChange[]): boolean {
  const revisions = new Set(
    stagedChanges
      .map((change) => change.commitSha?.trim() || "unknown")
      .filter((value) => value && value !== "unknown")
  );

  return revisions.size > 1;
}

export function toBatchSubmitInput(stagedChanges: OverlayStagedChange[]): OverlayBatchSubmitInput {
  return {
    changes: stagedChanges.map((change) => ({
      sourceLoc: change.sourceLoc,
      tagName: change.tagName,
      selectedText: change.selectedText,
      proposedText: change.proposedText,
      commitSha: change.commitSha,
    })),
  };
}
