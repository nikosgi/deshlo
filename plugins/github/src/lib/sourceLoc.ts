import { SourceInspectorError } from "./errors";
import type { ParsedSourceLoc } from "./types";

const SOURCE_LOC_PATTERN = /^(?<filePath>.+):(?<line>\d+):(?<column>\d+)$/;

export function parseSourceLoc(raw: string): ParsedSourceLoc {
  const trimmed = raw.trim();
  const match = SOURCE_LOC_PATTERN.exec(trimmed);

  if (!match || !match.groups) {
    throw new SourceInspectorError(
      "INVALID_SOURCE_LOC",
      "Invalid source location format. Expected path:line:column."
    );
  }

  const filePath = match.groups.filePath;
  const line = Number(match.groups.line);
  const column = Number(match.groups.column);

  if (!filePath || Number.isNaN(line) || Number.isNaN(column) || line < 1 || column < 1) {
    throw new SourceInspectorError(
      "INVALID_SOURCE_LOC",
      "Invalid source location values. Line and column must be positive integers."
    );
  }

  return {
    filePath,
    line,
    column,
  };
}

export function normalizeTextForComparison(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
