import type {
  AnnotationActionResult,
  AnnotationDeleteThreadInput,
  AnnotationListThreadsInput,
  AnnotationMoveThreadAnchorInput,
  AnnotationPlugin,
  AnnotationPluginContext,
  AnnotationReplyThreadInput,
  AnnotationThread,
  AnnotationThreadActionInput,
  AnnotationCreateThreadInput,
} from "./annotation-plugin";

export interface HttpAnnotationsPluginConfig {
  apiBaseUrl: string;
  apiKey: string;
  environment?: string;
}

function createHeaders(apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Deshlo-API-Key": apiKey,
  };
}

function toQuery(input: AnnotationListThreadsInput, context: AnnotationPluginContext, environment?: string): string {
  const query = new URLSearchParams();
  query.set("pageKey", context.pageKey);
  query.set("commitSha", context.commitSha);
  query.set("includeStale", input.includeStale ? "true" : "false");
  if (environment || context.environment) {
    query.set("environment", environment || context.environment || "");
  }
  return query.toString();
}

function ensureBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function toErrorResult(error: unknown): AnnotationActionResult {
  if (error instanceof Error) {
    return { ok: false, message: error.message };
  }
  return { ok: false, message: "Unexpected provider error." };
}

export function createHttpAnnotationsPlugin(config: HttpAnnotationsPluginConfig): AnnotationPlugin {
  const baseUrl = ensureBaseUrl(config.apiBaseUrl);
  const apiKey = config.apiKey.trim();

  return {
    id: "http-annotations",

    async listThreads(input: AnnotationListThreadsInput, context: AnnotationPluginContext): Promise<AnnotationThread[]> {
      if (!apiKey) {
        throw new Error("AUTH_REQUIRED: API key is required.");
      }

      const response = await fetch(`${baseUrl}/v1/threads?${toQuery(input, context, config.environment)}`, {
        method: "GET",
        headers: createHeaders(apiKey),
      });

      const body = (await response.json().catch(() => ({}))) as any;
      if (!response.ok || body?.ok === false) {
        throw new Error(body?.message || `Failed to list threads (${response.status}).`);
      }

      return body.threads || [];
    },

    async createThread(input: AnnotationCreateThreadInput): Promise<AnnotationActionResult> {
      if (!apiKey) {
        return { ok: false, message: "AUTH_REQUIRED: API key is required." };
      }

      try {
        const response = await fetch(`${baseUrl}/v1/threads`, {
          method: "POST",
          headers: createHeaders(apiKey),
          body: JSON.stringify({
            ...input,
            environment: config.environment || input.environment,
          }),
        });

        const body = (await response.json().catch(() => ({}))) as any;
        if (!response.ok || body?.ok === false) {
          return { ok: false, message: body?.message || `Failed to create thread (${response.status}).` };
        }

        return {
          ok: true,
          message: body?.message || "Thread created.",
        };
      } catch (error) {
        return toErrorResult(error);
      }
    },

    async replyToThread(input: AnnotationReplyThreadInput): Promise<AnnotationActionResult> {
      if (!apiKey) {
        return { ok: false, message: "AUTH_REQUIRED: API key is required." };
      }

      try {
        const response = await fetch(`${baseUrl}/v1/threads/${encodeURIComponent(input.threadId)}/replies`, {
          method: "POST",
          headers: createHeaders(apiKey),
          body: JSON.stringify({
            pageKey: input.pageKey,
            commitSha: input.commitSha,
            body: input.body,
            author: input.author,
          }),
        });

        const body = (await response.json().catch(() => ({}))) as any;
        if (!response.ok || body?.ok === false) {
          return { ok: false, message: body?.message || `Failed to reply (${response.status}).` };
        }

        return { ok: true, message: body?.message || "Reply added." };
      } catch (error) {
        return toErrorResult(error);
      }
    },

    async resolveThread(input: AnnotationThreadActionInput): Promise<AnnotationActionResult> {
      if (!apiKey) {
        return { ok: false, message: "AUTH_REQUIRED: API key is required." };
      }

      try {
        const response = await fetch(
          `${baseUrl}/v1/threads/${encodeURIComponent(input.threadId)}/resolve`,
          {
            method: "POST",
            headers: createHeaders(apiKey),
          }
        );

        const body = (await response.json().catch(() => ({}))) as any;
        if (!response.ok || body?.ok === false) {
          return { ok: false, message: body?.message || `Failed to resolve thread (${response.status}).` };
        }

        return { ok: true, message: body?.message || "Thread resolved." };
      } catch (error) {
        return toErrorResult(error);
      }
    },

    async reopenThread(input: AnnotationThreadActionInput): Promise<AnnotationActionResult> {
      if (!apiKey) {
        return { ok: false, message: "AUTH_REQUIRED: API key is required." };
      }

      try {
        const response = await fetch(
          `${baseUrl}/v1/threads/${encodeURIComponent(input.threadId)}/reopen`,
          {
            method: "POST",
            headers: createHeaders(apiKey),
          }
        );

        const body = (await response.json().catch(() => ({}))) as any;
        if (!response.ok || body?.ok === false) {
          return { ok: false, message: body?.message || `Failed to reopen thread (${response.status}).` };
        }

        return { ok: true, message: body?.message || "Thread reopened." };
      } catch (error) {
        return toErrorResult(error);
      }
    },

    async moveThreadAnchor(input: AnnotationMoveThreadAnchorInput): Promise<AnnotationActionResult> {
      if (!apiKey) {
        return { ok: false, message: "AUTH_REQUIRED: API key is required." };
      }

      try {
        const response = await fetch(
          `${baseUrl}/v1/threads/${encodeURIComponent(input.threadId)}/anchor`,
          {
            method: "PATCH",
            headers: createHeaders(apiKey),
            body: JSON.stringify({
              pageKey: input.pageKey,
              commitSha: input.commitSha,
              anchor: input.anchor,
            }),
          }
        );

        const body = (await response.json().catch(() => ({}))) as any;
        if (!response.ok || body?.ok === false) {
          return { ok: false, message: body?.message || `Failed to move thread (${response.status}).` };
        }

        return { ok: true, message: body?.message || "Thread anchor updated." };
      } catch (error) {
        return toErrorResult(error);
      }
    },

    async deleteThread(input: AnnotationDeleteThreadInput): Promise<AnnotationActionResult> {
      if (!apiKey) {
        return { ok: false, message: "AUTH_REQUIRED: API key is required." };
      }

      try {
        const query = new URLSearchParams();
        query.set("pageKey", input.pageKey);
        query.set("commitSha", input.commitSha);
        const response = await fetch(
          `${baseUrl}/v1/threads/${encodeURIComponent(input.threadId)}?${query.toString()}`,
          {
            method: "DELETE",
            headers: createHeaders(apiKey),
          }
        );

        const body = (await response.json().catch(() => ({}))) as any;
        if (!response.ok || body?.ok === false) {
          return { ok: false, message: body?.message || `Failed to delete thread (${response.status}).` };
        }

        return { ok: true, message: body?.message || "Thread deleted." };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  };
}
