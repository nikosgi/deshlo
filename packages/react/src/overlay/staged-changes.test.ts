import { describe, expect, it } from "vitest";

import {
  hasMixedKnownRevisions,
  removeStagedChangeBySourceLoc,
  toBatchSubmitInput,
  updateStagedChangeProposedText,
  upsertStagedChanges,
} from "./staged-changes";

const BASE_CHANGE = {
  sourceLoc: "app/page.tsx:1:1",
  tagName: "h1",
  selectedText: "Old",
  proposedText: "New",
  commitSha: "rev-1",
  stagedAt: "2024-01-01T00:00:00.000Z",
};

describe("staged change helpers", () => {
  it("upserts by sourceLoc", () => {
    const previous = [BASE_CHANGE];
    const next = {
      ...BASE_CHANGE,
      proposedText: "Updated again",
      stagedAt: "2024-01-02T00:00:00.000Z",
    };

    const upserted = upsertStagedChanges(previous, next);
    expect(upserted).toHaveLength(1);
    expect(upserted[0].proposedText).toBe("Updated again");
  });

  it("removes staged entry by sourceLoc", () => {
    const previous = [
      BASE_CHANGE,
      {
        ...BASE_CHANGE,
        sourceLoc: "app/page.tsx:2:1",
      },
    ];

    const next = removeStagedChangeBySourceLoc(previous, "app/page.tsx:1:1");
    expect(next).toHaveLength(1);
    expect(next[0].sourceLoc).toBe("app/page.tsx:2:1");
  });

  it("updates proposed text for an existing staged entry", () => {
    const previous = [BASE_CHANGE];
    const next = updateStagedChangeProposedText(previous, BASE_CHANGE.sourceLoc, "New text");

    expect(next).toHaveLength(1);
    expect(next[0].proposedText).toBe("New text");
  });

  it("detects mixed known revisions", () => {
    const mixed = [
      BASE_CHANGE,
      {
        ...BASE_CHANGE,
        sourceLoc: "app/page.tsx:2:1",
        commitSha: "rev-2",
      },
    ];

    expect(hasMixedKnownRevisions(mixed)).toBe(true);
    expect(
      hasMixedKnownRevisions([
        BASE_CHANGE,
        {
          ...BASE_CHANGE,
          sourceLoc: "app/page.tsx:2:1",
          commitSha: "unknown",
        },
      ])
    ).toBe(false);
  });

  it("converts staged changes to batch submit payload", () => {
    const payload = toBatchSubmitInput([BASE_CHANGE]);
    expect(payload).toEqual({
      changes: [
        {
          sourceLoc: "app/page.tsx:1:1",
          tagName: "h1",
          selectedText: "Old",
          proposedText: "New",
          commitSha: "rev-1",
        },
      ],
    });
  });
});
