import { describe, expect, it } from "vitest";
import { createGitHubBrowserPlugin } from "../plugin";

describe("createGitHubBrowserPlugin", () => {
  it("returns AUTH_REQUIRED when token is missing", async () => {
    const plugin = createGitHubBrowserPlugin({
      token: "",
    });

    const result = await plugin.submit(
      {
        sourceLoc: "app/page.tsx:1:1",
        tagName: "h1",
        selectedText: "Old",
        proposedText: "New",
      },
      { host: "localhost:3000" }
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("AUTH_REQUIRED");
  });
});
