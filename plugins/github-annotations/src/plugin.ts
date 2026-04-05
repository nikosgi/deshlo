import type {
  AnnotationPlugin,
  AnnotationActionResult,
  AnnotationCreateThreadInput,
  AnnotationListThreadsInput,
  AnnotationPluginContext,
  AnnotationReplyThreadInput,
  AnnotationThread,
  AnnotationThreadActionInput,
} from "@deshlo/core/annotations";

import { AnnotationProviderError } from "./lib/errors";
import { type HostConfigInput } from "./lib/hostConfig";
import {
  createThread,
  listThreads,
  reopenThread,
  replyThread,
  resolveThread,
  type GitHubAnnotationsRuntimeOptions,
} from "./lib/workflow";

export interface GitHubAnnotationsPluginConfig extends GitHubAnnotationsRuntimeOptions {
  token?: string;
  hostConfig?: HostConfigInput;
}

function resolveToken(config: GitHubAnnotationsPluginConfig): string {
  return config.token?.trim() || process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_GITHUB_TOKEN?.trim() || "";
}

function toActionResult(error: unknown): AnnotationActionResult {
  if (error instanceof AnnotationProviderError) {
    return {
      ok: false,
      message: `${error.code}: ${error.message}`,
    };
  }

  if (error instanceof Error) {
    return {
      ok: false,
      message: `PROVIDER_ERROR: ${error.message}`,
    };
  }

  return {
    ok: false,
    message: "PROVIDER_ERROR: Unexpected provider error.",
  };
}

async function withAction<T extends AnnotationActionResult | AnnotationThread[]>(
  action: () => Promise<T>
): Promise<T | AnnotationActionResult> {
  try {
    return await action();
  } catch (error) {
    return toActionResult(error);
  }
}

export function createGitHubAnnotationsPlugin(
  config: GitHubAnnotationsPluginConfig = {}
): AnnotationPlugin {
  return {
    id: "github-annotations",

    async listThreads(
      input: AnnotationListThreadsInput,
      context: AnnotationPluginContext
    ): Promise<AnnotationThread[]> {
      const token = resolveToken(config);
      if (!token) {
        return [];
      }

      const result = await withAction(() =>
        listThreads(input, context, {
          token,
          runtime: config,
        })
      );

      if (Array.isArray(result)) {
        return result;
      }

      return [];
    },

    async createThread(
      input: AnnotationCreateThreadInput,
      context: AnnotationPluginContext
    ): Promise<AnnotationActionResult> {
      const token = resolveToken(config);
      if (!token) {
        return {
          ok: false,
          message: "AUTH_REQUIRED: Configure NEXT_PUBLIC_DESHLO_ANNOTATIONS_GITHUB_TOKEN or pass token.",
        };
      }

      const result = await withAction(() =>
        createThread(input, context, {
          token,
          runtime: config,
        })
      );

      return Array.isArray(result)
        ? {
            ok: false,
            message: "PROVIDER_ERROR: Unexpected list result for createThread.",
          }
        : result;
    },

    async replyToThread(
      input: AnnotationReplyThreadInput,
      context: AnnotationPluginContext
    ): Promise<AnnotationActionResult> {
      const token = resolveToken(config);
      if (!token) {
        return {
          ok: false,
          message: "AUTH_REQUIRED: Configure NEXT_PUBLIC_DESHLO_ANNOTATIONS_GITHUB_TOKEN or pass token.",
        };
      }

      const result = await withAction(() =>
        replyThread(input, context, {
          token,
          runtime: config,
        })
      );

      return Array.isArray(result)
        ? {
            ok: false,
            message: "PROVIDER_ERROR: Unexpected list result for replyToThread.",
          }
        : result;
    },

    async resolveThread(
      input: AnnotationThreadActionInput,
      context: AnnotationPluginContext
    ): Promise<AnnotationActionResult> {
      const token = resolveToken(config);
      if (!token) {
        return {
          ok: false,
          message: "AUTH_REQUIRED: Configure NEXT_PUBLIC_DESHLO_ANNOTATIONS_GITHUB_TOKEN or pass token.",
        };
      }

      const result = await withAction(() =>
        resolveThread(input, context, {
          token,
          runtime: config,
        })
      );

      return Array.isArray(result)
        ? {
            ok: false,
            message: "PROVIDER_ERROR: Unexpected list result for resolveThread.",
          }
        : result;
    },

    async reopenThread(
      input: AnnotationThreadActionInput,
      context: AnnotationPluginContext
    ): Promise<AnnotationActionResult> {
      const token = resolveToken(config);
      if (!token) {
        return {
          ok: false,
          message: "AUTH_REQUIRED: Configure NEXT_PUBLIC_DESHLO_ANNOTATIONS_GITHUB_TOKEN or pass token.",
        };
      }

      const result = await withAction(() =>
        reopenThread(input, context, {
          token,
          runtime: config,
        })
      );

      return Array.isArray(result)
        ? {
            ok: false,
            message: "PROVIDER_ERROR: Unexpected list result for reopenThread.",
          }
        : result;
    },
  };
}

export type { GitHubAnnotationsRuntimeOptions };
