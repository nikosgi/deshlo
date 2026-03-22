export type SourceInspectorErrorCode =
  | "AUTH_REQUIRED"
  | "UNMAPPED_HOST"
  | "INVALID_SOURCE_LOC"
  | "BASE_BRANCH_NOT_FOUND"
  | "FILE_NOT_FOUND"
  | "NON_TEXT_NODE"
  | "TEXT_MISMATCH"
  | "NO_DIFF"
  | "PROVIDER_ERROR";

export interface ProposedChangeInput {
  sourceLoc: string;
  tagName: string;
  selectedText: string;
  proposedText: string;
  baseBranch: string;
  commitSha?: string;
}

export interface ParsedSourceLoc {
  filePath: string;
  line: number;
  column: number;
}

export interface PreviewChangeSuccess {
  filePath: string;
  oldText: string;
  newText: string;
  line: number;
  column: number;
  tagName: string;
  branchNamePreview: string;
}

export interface CreateDraftPrSuccess {
  branchName: string;
  commitSha: string;
  prNumber: number;
  prUrl: string;
}

export interface ActionFailure {
  ok: false;
  code: SourceInspectorErrorCode;
  message: string;
}

export interface ActionSuccess<T> {
  ok: true;
  data: T;
}

export type ActionResult<T> = ActionSuccess<T> | ActionFailure;

export interface BranchesSuccess {
  branches: string[];
  defaultBaseBranch: string;
}
