import {
  injectSourceAttributes,
  isSourceInspectorEnabled,
  resolveIncludePaths,
  type SourceInspectorAdapterOptions,
} from "@deshlo/core";

export interface SourceInspectorViteOptions extends SourceInspectorAdapterOptions {
  cwd?: string;
}

interface ViteLikePlugin {
  name: string;
  enforce?: "pre" | "post";
  transform: (code: string, id: string) => { code: string; map: unknown } | null;
}

function stripQuery(id: string): string {
  const queryIndex = id.indexOf("?");
  return queryIndex === -1 ? id : id.slice(0, queryIndex);
}

function isInIncludedPath(filePath: string, includes: string[]): boolean {
  return includes.some((basePath) => filePath === basePath || filePath.startsWith(`${basePath}/`));
}

export function withSourceInspectorVite(
  options: SourceInspectorViteOptions = {}
): ViteLikePlugin {
  const cwd = options.cwd ?? process.cwd();
  const includePaths = resolveIncludePaths(options.include, cwd);

  return {
    name: "source-inspector-vite",
    enforce: "pre",
    transform(code, id) {
      if (!isSourceInspectorEnabled(options)) {
        return null;
      }

      const filePath = stripQuery(id);

      if (!/\.[jt]sx?$/.test(filePath)) {
        return null;
      }

      if (filePath.includes("/node_modules/")) {
        return null;
      }

      if (!isInIncludedPath(filePath, includePaths)) {
        return null;
      }

      const result = injectSourceAttributes(code, filePath, {
        attributeName: options.attributeName,
        cwd,
        wrapLooseTextNodes: options.wrapLooseTextNodes,
        annotateLeafNodesOnly: options.annotateLeafNodesOnly,
      });

      if (!result.changed) {
        return null;
      }

      return {
        code: result.code,
        map: result.map,
      };
    },
  };
}
