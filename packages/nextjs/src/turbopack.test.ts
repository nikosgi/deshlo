import path from "node:path";

import { describe, expect, it } from "vitest";

import { applySourceInspectorTurbopack } from "./turbopack";

const CWD = "/repo";

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
    expect(Object.keys(result.turbopack?.rules ?? {})).toEqual(
      expect.arrayContaining([
        "app/**/*.js",
        "app/**/*.jsx",
        "app/**/*.ts",
        "app/**/*.tsx",
        "components/**/*.js",
        "components/**/*.jsx",
        "components/**/*.ts",
        "components/**/*.tsx",
      ])
    );

    const appRule = result.turbopack?.rules?.["app/**/*.tsx"];
    const firstRule = Array.isArray(appRule) ? appRule[0] : appRule;
    const firstLoader =
      firstRule && firstRule.loaders.length > 0 ? firstRule.loaders[0] : undefined;

    expect(firstRule).toMatchObject({
      as: "*.js",
      condition: { not: "foreign" },
    });
    expect(firstLoader).toMatchObject({
      loader: "@deshlo/loader",
      options: {
        attributeName: "data-src-loc",
        wrapLooseTextNodes: true,
        annotateLeafNodesOnly: true,
        includePaths: [path.resolve(CWD, "app"), path.resolve(CWD, "components")],
      },
    });
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
    expect(rules?.["app/**/*.tsx"]).toBeDefined();
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
    expect(result.turbopack?.rules?.["apps/next-test-app/app/**/*.tsx"]).toBeDefined();
  });
});
