import { describe, expect, it } from "vitest";

import {
  buildOverlaySubmitInput,
  normalizeOverlayText,
  toOverlayErrorResult,
} from "./overlay-plugin";

describe("overlay-plugin helpers", () => {
  it("normalizes mixed whitespace for selected text", () => {
    expect(normalizeOverlayText("\n  Hello   world\t")).toBe("Hello world");
  });

  it("builds submit payload from selection and proposed text", () => {
    const input = buildOverlaySubmitInput(
      {
        sourceLoc: "app/page.tsx:10:7",
        tagName: "h1",
        selectedText: "Current",
      },
      "  Updated text  "
    );

    expect(input).toEqual({
      sourceLoc: "app/page.tsx:10:7",
      tagName: "h1",
      selectedText: "Current",
      commitSha: "unknown",
      proposedText: "Updated text",
    });
  });

  it("normalizes thrown errors into overlay result", () => {
    const result = toOverlayErrorResult(new Error("provider failed"));
    expect(result).toEqual({
      ok: false,
      message: "provider failed",
    });
  });
});
