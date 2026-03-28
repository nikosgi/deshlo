import type {
  OverlayPlugin,
  OverlayPluginContext,
  OverlaySubmitInput,
  OverlaySubmitResult,
} from "@deshlo/core/overlay-plugin";

import { SourceInspectorError } from "./lib/errors";
import {
  createDraftPrFromProposedChange,
  getBranches,
  listProposedChanges,
  type SourceInspectorRuntimeOptions,
} from "./lib/workflow";

export interface GitHubBrowserPluginConfig extends SourceInspectorRuntimeOptions {
  token?: string;
  baseBranch?: string;
}

function resolveToken(config: GitHubBrowserPluginConfig): string {
  return (
    config.token?.trim() ||
    process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_GITHUB_TOKEN?.trim() ||
    ""
  );
}

function resolveHost(context: OverlayPluginContext, config: GitHubBrowserPluginConfig): string {
  return config.host || context.host || "unknown";
}

function toErrorResult(error: unknown): OverlaySubmitResult {
  if (error instanceof SourceInspectorError) {
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

function toProposedChangeInput(input: OverlaySubmitInput, baseBranch: string) {
  return {
    sourceLoc: input.sourceLoc,
    tagName: input.tagName,
    selectedText: input.selectedText,
    proposedText: input.proposedText,
    commitSha: input.commitSha,
    baseBranch,
  };
}

export function createGitHubBrowserPlugin(
  config: GitHubBrowserPluginConfig = {}
): OverlayPlugin {
  return {
    id: "github-browser",
    async submit(
      input: OverlaySubmitInput,
      context: OverlayPluginContext
    ): Promise<OverlaySubmitResult> {
      const token = resolveToken(config);
      if (!token) {
        return {
          ok: false,
          message:
            "AUTH_REQUIRED: Configure NEXT_PUBLIC_SOURCE_INSPECTOR_GITHUB_TOKEN or pass token.",
        };
      }

      const runtime = {
        ...config,
        host: resolveHost(context, config),
      };

      try {
        const baseBranch =
          config.baseBranch ||
          (await getBranches({
            token,
            runtime,
          })).defaultBaseBranch;

        const result = await createDraftPrFromProposedChange(
          toProposedChangeInput(input, baseBranch),
          {
            token,
            runtime,
          }
        );

        const actionLabel = result.action === "updated" ? "updated" : "created";

        return {
          ok: true,
          message: `Draft PR #${result.prNumber} ${actionLabel} on branch ${result.branchName}.`,
          links: [
            {
              label: `Open PR #${result.prNumber}`,
              url: result.prUrl,
            },
          ],
        };
      } catch (error) {
        return toErrorResult(error);
      }
    },
    async listProposedChanges(context: OverlayPluginContext) {
      const token = resolveToken(config);
      if (!token) {
        return [];
      }

      const runtime = {
        ...config,
        host: resolveHost(context, config),
      };

      return listProposedChanges({
        token,
        runtime,
      });
    },
  };
}

export type { SourceInspectorRuntimeOptions };
