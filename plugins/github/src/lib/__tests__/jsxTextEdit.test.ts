import { describe, expect, it } from "vitest";

import { SourceInspectorError } from "../errors";
import { applyTextReplacement } from "../jsxTextEdit";

const SIMPLE_SOURCE = `export default function Page() {
  return (
    <main>
      <h1>Hello title</h1>
    </main>
  );
}
`;

const NO_TEXT_SOURCE = `export default function Page() {
  return (
    <main>
      <h1><span>Hello</span></h1>
    </main>
  );
}
`;

const MULTI_TEXT_SOURCE = `export default function Page() {
  return (
    <main>
      <h1>Hello <strong>team</strong></h1>
    </main>
  );
}
`;

describe("applyTextReplacement", () => {
  it("replaces direct text for matched JSX element", () => {
    const result = applyTextReplacement({
      sourceCode: SIMPLE_SOURCE,
      sourceLoc: { filePath: "app/page.tsx", line: 4, column: 7 },
      tagName: "h1",
      selectedText: "Hello title",
      proposedText: "Updated title",
    });

    expect(result.oldText).toBe("Hello title");
    expect(result.newText).toBe("Updated title");
    expect(result.updatedSourceCode).toContain("<h1>Updated title</h1>");
  });

  it("throws NON_TEXT_NODE for nested element children", () => {
    expect(() =>
      applyTextReplacement({
        sourceCode: NO_TEXT_SOURCE,
        sourceLoc: { filePath: "app/page.tsx", line: 4, column: 7 },
        tagName: "h1",
        selectedText: "Hello",
        proposedText: "Updated",
      })
    ).toThrow(SourceInspectorError);
  });

  it("throws NON_TEXT_NODE for mixed/ambiguous text", () => {
    expect(() =>
      applyTextReplacement({
        sourceCode: MULTI_TEXT_SOURCE,
        sourceLoc: { filePath: "app/page.tsx", line: 4, column: 7 },
        tagName: "h1",
        selectedText: "Hello team",
        proposedText: "Updated",
      })
    ).toThrow(SourceInspectorError);
  });

  it("throws TEXT_MISMATCH when selected text differs from source", () => {
    expect(() =>
      applyTextReplacement({
        sourceCode: SIMPLE_SOURCE,
        sourceLoc: { filePath: "app/page.tsx", line: 4, column: 7 },
        tagName: "h1",
        selectedText: "Different",
        proposedText: "Updated",
      })
    ).toThrow(SourceInspectorError);
  });

  it("throws NO_DIFF when proposed text is unchanged", () => {
    expect(() =>
      applyTextReplacement({
        sourceCode: SIMPLE_SOURCE,
        sourceLoc: { filePath: "app/page.tsx", line: 4, column: 7 },
        tagName: "h1",
        selectedText: "Hello title",
        proposedText: "Hello title",
      })
    ).toThrow(SourceInspectorError);
  });
});
