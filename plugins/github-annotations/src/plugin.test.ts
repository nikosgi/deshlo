import { describe, expect, it } from "vitest";

import { createGitHubAnnotationsPlugin } from "./plugin";

describe("createGitHubAnnotationsPlugin", () => {
  it("returns AUTH_REQUIRED for mutating actions when token is missing", async () => {
    const plugin = createGitHubAnnotationsPlugin({ token: "" });

    const result = await plugin.createThread(
      {
        pageKey: "https://example.com/about",
        commitSha: "rev-1",
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
        body: "hello",
      },
      {
        host: "localhost:3000",
        pageKey: "https://example.com/about",
        commitSha: "rev-1",
      }
    );

    expect(result.ok).toBe(false);
    expect(result.message.startsWith("AUTH_REQUIRED")).toBe(true);
  });

  it("returns an empty list when token is missing", async () => {
    const plugin = createGitHubAnnotationsPlugin({ token: "" });

    const threads = await plugin.listThreads(
      { includeStale: true },
      {
        host: "localhost:3000",
        pageKey: "https://example.com/about",
        commitSha: "rev-1",
      }
    );

    expect(threads).toEqual([]);
  });
});
