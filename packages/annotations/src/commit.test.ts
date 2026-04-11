import { describe, expect, it } from "vitest";

import { isKnownCommitSha } from "./commit";

describe("isKnownCommitSha", () => {
  it("returns false for unknown values", () => {
    expect(isKnownCommitSha("unknown")).toBe(false);
    expect(isKnownCommitSha("")).toBe(false);
    expect(isKnownCommitSha(undefined)).toBe(false);
  });

  it("returns true for real commit values", () => {
    expect(isKnownCommitSha("abc123")).toBe(true);
  });
});
