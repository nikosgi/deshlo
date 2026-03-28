export type TriggerKey = "alt" | "shift" | "meta" | "ctrl";

export interface OverlaySelection {
  sourceLoc: string;
  tagName: string;
  selectedText: string;
  commitSha?: string;
}

export interface OverlaySubmitInput extends OverlaySelection {
  proposedText: string;
}

export interface OverlayProposedChange {
  changeId: string;
  sourceLoc: string;
  tagName: string;
  selectedText: string;
  proposedText: string;
  status: string;
  baseBranch: string;
  baseCommitSha: string;
  lastAppliedCommitSha: string;
  updatedAt: string;
  prNumber: number;
  prUrl: string;
}

export interface OverlayResultLink {
  label: string;
  url: string;
}

export interface OverlaySubmitResult {
  ok: boolean;
  message: string;
  links?: OverlayResultLink[];
}

export interface OverlayPluginContext {
  host: string;
}

export type OverlaySubmitHandler = (
  input: OverlaySubmitInput,
  context: OverlayPluginContext
) => Promise<OverlaySubmitResult> | OverlaySubmitResult;

export type OverlayListProposedChangesHandler = (
  context: OverlayPluginContext
) => Promise<OverlayProposedChange[]> | OverlayProposedChange[];

export interface OverlayPlugin {
  id: string;
  submit: OverlaySubmitHandler;
  listProposedChanges?: OverlayListProposedChangesHandler;
}

export function normalizeOverlayText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildOverlaySubmitInput(
  selection: OverlaySelection,
  proposedText: string
): OverlaySubmitInput {
  return {
    sourceLoc: selection.sourceLoc,
    tagName: selection.tagName,
    selectedText: selection.selectedText,
    commitSha: selection.commitSha ?? "unknown",
    proposedText: proposedText.trim(),
  };
}

export function toOverlayErrorResult(error: unknown): OverlaySubmitResult {
  if (error instanceof Error) {
    return {
      ok: false,
      message: error.message,
    };
  }

  return {
    ok: false,
    message: "Unexpected plugin error.",
  };
}
