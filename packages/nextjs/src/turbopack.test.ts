import path from "node:path";

import { describe, expect, it } from "vitest";

import { applySourceInspectorTurbopack } from "./turbopack";

const CWD = "/repo";

function hasLoaders(entry: unknown): entry is { loaders: unknown[] } {
  return typeof entry === "object" && entry !== null && "loaders" in entry;
}

describe("applySourceInspectorTurbopack", () => {
  it("creates turbopack rules when config has no turbopack section", () => {
    const result = applySourceInspectorTurbopack(
      {
        reactStrictMode: true,
      },
      {
        enabled: true,
        include: ["app", "components"],
        wrapLooseTextNodes: true,
        annotateLeafNodesOnly: true,
        cwd: CWD,
      }
    );

    expect(result.turbopack?.rules).toBeDefined();
    expect(Object.keys(result.turbopack?.rules ?? {})).toEqual(expect.arrayContaining(["*"]));

    const wildcardRule = result.turbopack?.rules?.["*"];
    const firstRule = Array.isArray(wildcardRule)
      ? wildcardRule.find((entry) => hasLoaders(entry))
      : wildcardRule;
    const firstLoader =
      hasLoaders(firstRule) && firstRule.loaders.length > 0 ? firstRule.loaders[0] : undefined;
    const condition = firstRule && typeof firstRule === "object" ? firstRule.condition : undefined;
    const allConditions =
      condition &&
      typeof condition === "object" &&
      "all" in condition &&
      Array.isArray(condition.all)
        ? condition.all
        : [];

    const includeConditionEntry = allConditions.find(
      (entry) => typeof entry === "object" && entry !== null && "any" in entry
    ) as { any: { path: RegExp }[] } | undefined;

    expect(firstRule).toBeDefined();
    expect(firstLoader).toMatchObject({
      loader: "@deshlo/loader",
      options: {
        attributeName: "data-src-loc",
        wrapLooseTextNodes: true,
        annotateLeafNodesOnly: true,
        includePaths: [path.resolve(CWD, "app"), path.resolve(CWD, "components")],
      },
    });
    expect(allConditions).toEqual(expect.arrayContaining([{ not: "foreign" }]));
    expect(includeConditionEntry?.any.length).toBe(2);
    expect(includeConditionEntry?.any[0]?.path).toBeInstanceOf(RegExp);
    expect(includeConditionEntry?.any[1]?.path).toBeInstanceOf(RegExp);
    expect(result.turbopack?.root).toBe(CWD);
  });

  it("merges into existing turbopack rules", () => {
    const result = applySourceInspectorTurbopack(
      {
        turbopack: {
          rules: {
            "*.mdx": {
              loaders: ["mdx-loader"],
              as: "*.js",
            },
          },
        },
      },
      {
        enabled: true,
        include: ["app"],
        cwd: CWD,
      }
    );

    const rules = result.turbopack?.rules as Record<string, unknown> | undefined;
    expect(rules?.["*.mdx"]).toBeDefined();
    expect(rules?.["*"]).toBeDefined();
  });

  it("merges into legacy experimental turbo config", () => {
    const result = applySourceInspectorTurbopack(
      {
        experimental: {
          turbo: {
            loaders: {
              ".mdx": ["mdx-loader"],
            },
          },
        },
      },
      {
        enabled: true,
        include: ["app"],
        cwd: CWD,
      }
    );

    const loaders = result.experimental?.turbo?.loaders as
      | Record<string, unknown[]>
      | undefined;
    expect(loaders?.[".mdx"]).toEqual(["mdx-loader"]);
    expect(loaders?.[".tsx"]).toBeDefined();
    expect(loaders?.[".tsx"]?.[0]).toMatchObject({
      loader: "@deshlo/loader",
    });
  });

  it("does nothing when disabled", () => {
    const nextConfig = {
      reactStrictMode: true,
    };

    const result = applySourceInspectorTurbopack(nextConfig, {
      enabled: false,
      include: ["app"],
      cwd: CWD,
    });

    expect(result).toBe(nextConfig);
  });

  it("builds include globs relative to workspace root in monorepos", () => {
    const workspaceRoot = "/repo";
    const appDir = "/repo/apps/next-test-app";

    const result = applySourceInspectorTurbopack(
      {
        reactStrictMode: true,
        turbopack: {
          root: workspaceRoot,
        },
      },
      {
        enabled: true,
        include: ["app"],
        cwd: appDir,
      }
    );

    expect(result.turbopack?.root).toBe(workspaceRoot);
    const rule = result.turbopack?.rules?.["*"];
    const firstRule = Array.isArray(rule) ? rule.find((entry) => hasLoaders(entry)) : rule;
    const condition = firstRule && typeof firstRule === "object" ? firstRule.condition : undefined;
    const allConditions =
      condition &&
      typeof condition === "object" &&
      "all" in condition &&
      Array.isArray(condition.all)
        ? condition.all
        : [];
    const includeConditionEntry = allConditions.find(
      (entry) => typeof entry === "object" && entry !== null && "path" in entry
    ) as { path: RegExp } | undefined;

    expect(includeConditionEntry?.path).toBeInstanceOf(RegExp);
    expect(includeConditionEntry?.path.source).toMatch(/apps\\\/next-test-app\\\/app/);
  });
});
