import { describe, expect, it } from "vitest";

import { groupThreadsByRevision } from "./threads";

const BASE_THREAD = {
  threadId: "thread-1",
  pageKey: "https://example.com/about",
  commitSha: "rev-1",
  status: "open" as const,
  anchor: {
    viewport: { width: 100, height: 100 },
    pageScroll: { x: 0, y: 0 },
    targetRect: { left: 10, top: 10, width: 10, height: 10 },
    targetPoint: { x: 12, y: 14 },
    normalized: {
      viewportXRatio: 0.1,
      viewportYRatio: 0.1,
      rectXRatio: 0.2,
      rectYRatio: 0.3,
    },
    scrollChain: [],
  },
  messages: [{ messageId: "m1", body: "hello", createdAt: "2024-01-01T00:00:00.000Z" }],
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

describe("thread grouping", () => {
  it("separates current and stale threads", () => {
    const grouped = groupThreadsByRevision(
      [
        BASE_THREAD,
        {
          ...BASE_THREAD,
          threadId: "thread-2",
          commitSha: "rev-2",
          updatedAt: "2024-01-03T00:00:00.000Z",
        },
      ],
      "rev-1"
    );

    expect(grouped.current).toHaveLength(1);
    expect(grouped.current[0].threadId).toBe("thread-1");
    expect(grouped.stale).toHaveLength(1);
    expect(grouped.stale[0].threadId).toBe("thread-2");
  });

  it("treats unknown current revision as read-only stale listing", () => {
    const grouped = groupThreadsByRevision([BASE_THREAD], "unknown");
    expect(grouped.current).toHaveLength(0);
    expect(grouped.stale).toHaveLength(1);
  });
});
