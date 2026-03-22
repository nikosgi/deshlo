import { describe, expect, it } from "vitest";

import { SourceInspectorError } from "../errors";
import { normalizeTextForComparison, parseSourceLoc } from "../sourceLoc";

describe("parseSourceLoc", () => {
  it("parses a valid source location", () => {
    expect(parseSourceLoc("app/page.tsx:12:7")).toEqual({
      filePath: "app/page.tsx",
      line: 12,
      column: 7,
    });
  });

  it("throws on invalid format", () => {
    expect(() => parseSourceLoc("app/page.tsx:12")).toThrow(SourceInspectorError);
  });

  it("throws on non-positive values", () => {
    expect(() => parseSourceLoc("app/page.tsx:0:1")).toThrow(SourceInspectorError);
    expect(() => parseSourceLoc("app/page.tsx:1:0")).toThrow(SourceInspectorError);
  });
});

describe("normalizeTextForComparison", () => {
  it("collapses whitespace", () => {
    expect(normalizeTextForComparison(" Hello\n  world \t")).toBe("Hello world");
  });
});
