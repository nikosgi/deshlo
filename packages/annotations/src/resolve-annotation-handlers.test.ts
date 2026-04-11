import { describe, expect, it, vi } from "vitest";

import type { AnnotationPlugin } from "./annotation-plugin";
import { resolveAnnotationHandlers } from "./resolve-annotation-handlers";

describe("resolveAnnotationHandlers", () => {
  it("prefers wrapper plugin handlers over callbacks", async () => {
    const pluginCreate = vi.fn().mockResolvedValue({ ok: true, message: "plugin" });
    const callbackCreate = vi.fn().mockResolvedValue({ ok: true, message: "callback" });

    const plugin: AnnotationPlugin = {
      id: "github-annotations",
      listThreads: vi.fn().mockResolvedValue([]),
      createThread: pluginCreate,
      replyToThread: vi.fn(),
      resolveThread: vi.fn(),
      reopenThread: vi.fn(),
    };

    const resolved = resolveAnnotationHandlers(plugin, {
      onCreateThread: callbackCreate,
    });

    await resolved.createThread?.(
      {
        pageKey: "https://example.com/",
        commitSha: "abc",
        anchor: {
          viewport: { width: 100, height: 100 },
          pageScroll: { x: 0, y: 0 },
          targetRect: { left: 10, top: 10, width: 10, height: 10 },
          targetPoint: { x: 10, y: 10 },
          normalized: {
            viewportXRatio: 0.5,
            viewportYRatio: 0.5,
            rectXRatio: 0.5,
            rectYRatio: 0.5,
          },
          scrollChain: [],
        },
        body: "hello",
      },
      {
        host: "localhost:3000",
        pageKey: "https://example.com/",
        commitSha: "abc",
      }
    );

    expect(pluginCreate).toHaveBeenCalledTimes(1);
    expect(callbackCreate).not.toHaveBeenCalled();
  });

  it("uses callbacks when wrapper plugin is absent", () => {
    const callbackList = vi.fn().mockResolvedValue([]);

    const resolved = resolveAnnotationHandlers(null, {
      onListThreads: callbackList,
    });

    expect(resolved.pluginId).toBe("custom-callbacks");
    expect(resolved.listThreads).toBeDefined();
  });

  it("returns unconfigured when no handlers exist", () => {
    const resolved = resolveAnnotationHandlers(null, {});
    expect(resolved.pluginId).toBe("unconfigured");
    expect(resolved.createThread).toBeUndefined();
  });
});
