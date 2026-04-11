import { normalizeTextForComparison } from "./sourceLoc";

export const DESHLO_STATE_START_MARKER = "<!-- deshlo:state:start -->";
export const DESHLO_STATE_END_MARKER = "<!-- deshlo:state:end -->";
const DESHLO_HIDDEN_BLOCK_START = "<!-- deshlo:state:start";
const DESHLO_HIDDEN_BLOCK_END = "deshlo:state:end -->";

const MANAGED_BY = "deshlo/source-inspector";
const STATE_VERSION = 1;

export interface ManagedPrStateBase {
  branch: string;
  commitSha: string;
}

export interface ManagedPrChangeEntry {
  changeId: string;
  sourceLoc: string;
  tagName: string;
  selectedText: string;
  proposedText: string;
  lastAppliedCommitSha: string;
  status: "pending";
  updatedAt: string;
}

export interface ManagedPrState {
  version: number;
  managedBy: string;
  base: ManagedPrStateBase;
  changes: ManagedPrChangeEntry[];
  updatedAt: string;
}

export interface UpsertManagedChangeInput {
  sourceLoc: string;
  tagName: string;
  selectedText: string;
  proposedText: string;
  lastAppliedCommitSha: string;
  updatedAt: string;
}

interface MarkerRange {
  start: number;
  end: number;
  jsonStartOffset: number;
  jsonEndOffset: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isManagedStateBase(value: unknown): value is ManagedPrStateBase {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ManagedPrStateBase>;
  return isNonEmptyString(candidate.branch) && isNonEmptyString(candidate.commitSha);
}

function isManagedChangeEntry(value: unknown): value is ManagedPrChangeEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ManagedPrChangeEntry>;
  return (
    isNonEmptyString(candidate.changeId) &&
    isNonEmptyString(candidate.sourceLoc) &&
    isNonEmptyString(candidate.tagName) &&
    isNonEmptyString(candidate.selectedText) &&
    isNonEmptyString(candidate.proposedText) &&
    isNonEmptyString(candidate.lastAppliedCommitSha) &&
    candidate.status === "pending" &&
    isNonEmptyString(candidate.updatedAt)
  );
}

function isManagedPrState(value: unknown): value is ManagedPrState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ManagedPrState>;
  return (
    candidate.version === STATE_VERSION &&
    candidate.managedBy === MANAGED_BY &&
    isManagedStateBase(candidate.base) &&
    Array.isArray(candidate.changes) &&
    candidate.changes.every(isManagedChangeEntry) &&
    isNonEmptyString(candidate.updatedAt)
  );
}

function findMarkerRange(body: string): MarkerRange | null {
  const hiddenStartIndex = body.indexOf(DESHLO_HIDDEN_BLOCK_START);
  if (hiddenStartIndex >= 0) {
    const hiddenStartTail = body
      .slice(
        hiddenStartIndex + DESHLO_HIDDEN_BLOCK_START.length,
        hiddenStartIndex + DESHLO_HIDDEN_BLOCK_START.length + 4
      )
      .trimStart();
    if (hiddenStartTail.startsWith("-->")) {
      // Legacy split-marker format.
    } else {
    const hiddenEndIndex = body.indexOf(
      DESHLO_HIDDEN_BLOCK_END,
      hiddenStartIndex + DESHLO_HIDDEN_BLOCK_START.length
    );
    if (hiddenEndIndex >= 0) {
      return {
        start: hiddenStartIndex,
        end: hiddenEndIndex + DESHLO_HIDDEN_BLOCK_END.length,
        jsonStartOffset: hiddenStartIndex + DESHLO_HIDDEN_BLOCK_START.length,
        jsonEndOffset: hiddenEndIndex,
      };
    }
    }
  }

  const startIndex = body.indexOf(DESHLO_STATE_START_MARKER);
  if (startIndex < 0) {
    return null;
  }

  const endIndex = body.indexOf(DESHLO_STATE_END_MARKER, startIndex + DESHLO_STATE_START_MARKER.length);
  if (endIndex < 0) {
    return null;
  }

  return {
    start: startIndex,
    end: endIndex + DESHLO_STATE_END_MARKER.length,
    jsonStartOffset: startIndex + DESHLO_STATE_START_MARKER.length,
    jsonEndOffset: endIndex,
  };
}

function getBodyStateJson(body: string): string | null {
  const markerRange = findMarkerRange(body);
  if (!markerRange) {
    return null;
  }

  const json = body.slice(markerRange.jsonStartOffset, markerRange.jsonEndOffset).trim();

  return json || null;
}

function createChangeId(sourceLoc: string, updatedAt: string): string {
  const normalized = normalizeTextForComparison(sourceLoc).replace(/[^a-z0-9]+/g, "-");
  const safeSourceLoc = normalized.replace(/^-+|-+$/g, "") || "change";
  return `${safeSourceLoc}-${updatedAt}`;
}

function buildStateBlock(state: ManagedPrState): string {
  return `<!-- deshlo:state:start
${JSON.stringify(state, null, 2)}
deshlo:state:end -->`;
}

export function parseManagedPrState(body: string | null | undefined): ManagedPrState | null {
  if (!body) {
    return null;
  }

  const stateJson = getBodyStateJson(body);
  if (!stateJson) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stateJson);
  } catch {
    return null;
  }

  return isManagedPrState(parsed) ? parsed : null;
}

export function createManagedPrState(
  base: ManagedPrStateBase,
  firstChange: Omit<ManagedPrChangeEntry, "changeId" | "status">
): ManagedPrState {
  return {
    version: STATE_VERSION,
    managedBy: MANAGED_BY,
    base,
    changes: [
      {
        changeId: createChangeId(firstChange.sourceLoc, firstChange.updatedAt),
        sourceLoc: firstChange.sourceLoc,
        tagName: firstChange.tagName,
        selectedText: firstChange.selectedText,
        proposedText: firstChange.proposedText,
        lastAppliedCommitSha: firstChange.lastAppliedCommitSha,
        status: "pending",
        updatedAt: firstChange.updatedAt,
      },
    ],
    updatedAt: firstChange.updatedAt,
  };
}

export function upsertManagedPrStateChange(
  state: ManagedPrState,
  change: UpsertManagedChangeInput
): ManagedPrState {
  const existing = state.changes.find((entry) => entry.sourceLoc === change.sourceLoc);

  const updatedEntry: ManagedPrChangeEntry = {
    changeId: existing?.changeId || createChangeId(change.sourceLoc, change.updatedAt),
    sourceLoc: change.sourceLoc,
    tagName: change.tagName,
    selectedText: change.selectedText,
    proposedText: change.proposedText,
    lastAppliedCommitSha: change.lastAppliedCommitSha,
    status: "pending",
    updatedAt: change.updatedAt,
  };

  const nextChanges = state.changes.filter((entry) => entry.sourceLoc !== change.sourceLoc);
  nextChanges.push(updatedEntry);

  return {
    ...state,
    changes: nextChanges,
    updatedAt: change.updatedAt,
  };
}

export function writeManagedPrState(body: string | null | undefined, state: ManagedPrState): string {
  const stateBlock = buildStateBlock(state);
  const existingBody = body?.trim() || "";

  if (!existingBody) {
    return `This draft PR is managed by Deshlo Source Inspector.

${stateBlock}`;
  }

  const markerRange = findMarkerRange(existingBody);
  if (!markerRange) {
    return `${existingBody}

${stateBlock}`;
  }

  const before = existingBody.slice(0, markerRange.start).trimEnd();
  const after = existingBody.slice(markerRange.end).trimStart();

  if (before && after) {
    return `${before}

${stateBlock}

${after}`;
  }

  if (before) {
    return `${before}

${stateBlock}`;
  }

  if (after) {
    return `${stateBlock}

${after}`;
  }

  return stateBlock;
}
