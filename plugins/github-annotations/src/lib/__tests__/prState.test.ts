import { describe, expect, it } from "vitest";

import {
  appendThreadMessage,
  createManagedAnnotationsState,
  listThreadsFromState,
  parseManagedAnnotationsState,
  setThreadStatus,
  upsertThread,
  writeManagedAnnotationsState,
} from "../prState";

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
  messages: [
    {
      messageId: "msg-1",
      body: "hello",
      createdAt: "2024-01-01T00:00:00.000Z",
    },
  ],
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

describe("annotations PR state", () => {
  it("serializes and parses managed state from hidden marker block", () => {
    const state = createManagedAnnotationsState("rev-1", BASE_THREAD, "2024-01-01T00:00:00.000Z");
    const body = writeManagedAnnotationsState("", state);

    const parsed = parseManagedAnnotationsState(body);
    expect(parsed).not.toBeNull();
    expect(parsed?.commitSha).toBe("rev-1");
    expect(listThreadsFromState(parsed!, BASE_THREAD.pageKey)).toHaveLength(1);
  });

  it("upserts a thread by threadId", () => {
    const state = createManagedAnnotationsState("rev-1", BASE_THREAD, "2024-01-01T00:00:00.000Z");
    const updated = upsertThread(
      state,
      {
        ...BASE_THREAD,
        messages: [...BASE_THREAD.messages, { messageId: "msg-2", body: "second", createdAt: "2024-01-02T00:00:00.000Z" }],
        updatedAt: "2024-01-02T00:00:00.000Z",
      },
      "2024-01-02T00:00:00.000Z"
    );

    const threads = listThreadsFromState(updated, BASE_THREAD.pageKey);
    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(2);
  });

  it("appends message and updates status", () => {
    const state = createManagedAnnotationsState("rev-1", BASE_THREAD, "2024-01-01T00:00:00.000Z");
    const withReply = appendThreadMessage(state, {
      pageKey: BASE_THREAD.pageKey,
      threadId: BASE_THREAD.threadId,
      message: {
        messageId: "msg-2",
        body: "reply",
        createdAt: "2024-01-02T00:00:00.000Z",
      },
      updatedAt: "2024-01-02T00:00:00.000Z",
    });

    expect(withReply).not.toBeNull();
    expect(listThreadsFromState(withReply!, BASE_THREAD.pageKey)[0].messages).toHaveLength(2);

    const resolved = setThreadStatus(withReply!, {
      pageKey: BASE_THREAD.pageKey,
      threadId: BASE_THREAD.threadId,
      status: "resolved",
      updatedAt: "2024-01-03T00:00:00.000Z",
    });

    expect(resolved).not.toBeNull();
    expect(listThreadsFromState(resolved!, BASE_THREAD.pageKey)[0].status).toBe("resolved");
  });
});
