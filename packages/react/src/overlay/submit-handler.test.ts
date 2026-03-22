import { describe, expect, it, vi } from "vitest";

import type { OverlayPlugin } from "./overlay-plugin";
import { resolveSubmitHandler } from "./submit-handler";

describe("resolveSubmitHandler", () => {
  it("prefers wrapper plugin submit over onSubmit", async () => {
    const pluginSubmit = vi.fn().mockResolvedValue({
      ok: true,
      message: "plugin",
    });
    const onSubmit = vi.fn().mockResolvedValue({
      ok: true,
      message: "callback",
    });

    const plugin: OverlayPlugin = {
      id: "github-browser",
      submit: pluginSubmit,
    };

    const resolved = resolveSubmitHandler(plugin, onSubmit);
    expect(resolved.pluginId).toBe("github-browser");

    const result = await resolved.submit?.(
      {
        sourceLoc: "app/page.tsx:1:1",
        tagName: "h1",
        selectedText: "Old",
        proposedText: "New",
      },
      { host: "localhost:3000" }
    );

    expect(result?.message).toBe("plugin");
    expect(pluginSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("uses onSubmit when no wrapper plugin exists", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      ok: true,
      message: "callback",
    });

    const resolved = resolveSubmitHandler(null, onSubmit);
    expect(resolved.pluginId).toBe("custom-onsubmit");

    const result = await resolved.submit?.(
      {
        sourceLoc: "app/page.tsx:1:1",
        tagName: "h1",
        selectedText: "Old",
        proposedText: "New",
      },
      { host: "localhost:3000" }
    );

    expect(result?.message).toBe("callback");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("returns unconfigured when neither wrapper nor onSubmit exists", () => {
    const resolved = resolveSubmitHandler(null, undefined);
    expect(resolved.pluginId).toBe("unconfigured");
    expect(resolved.submit).toBeUndefined();
  });
});
