import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

import {
  buildSourceInspectorLoaderOptions,
  isSourceInspectorEnabled,
  type SourceInspectorAdapterOptions,
} from "@deshlo/core";

export interface NextjsTurbopackOptions extends SourceInspectorAdapterOptions {
  cwd?: string;
}

export type NextTurbopackConfig = NonNullable<NextConfig["turbopack"]>;
export type TurbopackRules = NonNullable<NextTurbopackConfig["rules"]>;
export type TurbopackRuleConfigCollection = TurbopackRules[string];
export type TurbopackRuleCollectionItem = Extract<TurbopackRuleConfigCollection, unknown[]>[number];
export type TurbopackRule = Extract<TurbopackRuleConfigCollection, { loaders: unknown[] }>;
export type TurbopackLoader = TurbopackRule["loaders"][number];
type TurbopackObjectLoader = Extract<TurbopackLoader, { loader: string }>;

export interface LegacyTurboConfig {
  root?: string;
  rules?: TurbopackRules;
  loaders?: Record<string, TurbopackLoader[]>;
  [key: string]: any;
}

export interface NextJsLikeConfig extends NextConfig {
  experimental?: (NextConfig["experimental"] & { turbo?: LegacyTurboConfig }) | undefined;
}

const TURBOPACK_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"] as const;
const SOURCE_INSPECTOR_LOADER = "@deshlo/loader";
const ROOT_MARKER_FILES = [
  "yarn.lock",
  "pnpm-lock.yaml",
  "package-lock.json",
  "bun.lock",
  "bun.lockb",
] as const;

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toTurbopackPathCondition(includePath: string, rootDir: string): RegExp {
  const relativePath = toPosixPath(path.relative(rootDir, includePath)).replace(/^\.\/+/, "");
  const extensionsPattern = TURBOPACK_EXTENSIONS.map((extension) => extension.slice(1))
    .map(escapeForRegex)
    .join("|");

  if (relativePath.length === 0 || relativePath === "." || relativePath.startsWith("../")) {
    return new RegExp(`\\.(?:${extensionsPattern})$`);
  }

  const normalizedRelativePath = escapeForRegex(relativePath.replace(/\/+$/, ""));
  return new RegExp(
    `(?:^|\\[project\\]/)${normalizedRelativePath}(?:/.*)?\\.(?:${extensionsPattern})$`
  );
}

function findWorkspaceRoot(cwd: string): string {
  const startDir = path.resolve(cwd);
  let currentDir = startDir;

  while (true) {
    const hasRootMarker = ROOT_MARKER_FILES.some((fileName) =>
      existsSync(path.join(currentDir, fileName))
    );
    if (hasRootMarker) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return startDir;
    }

    currentDir = parentDir;
  }
}

function normalizeRootPath(rootPath: unknown, cwd: string): string | undefined {
  if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
    return undefined;
  }

  return path.resolve(cwd, rootPath);
}

function resolveTurbopackRoot(nextConfig: NextJsLikeConfig, cwd: string): string {
  const configuredRoot =
    normalizeRootPath(nextConfig.turbopack?.root, cwd) ??
    normalizeRootPath(nextConfig.experimental?.turbo?.root, cwd);

  return configuredRoot ?? findWorkspaceRoot(cwd);
}

function isTurbopackRule(entry: TurbopackRuleCollectionItem): entry is TurbopackRule {
  return typeof entry === "object" && entry !== null && "loaders" in entry;
}

function toTurbopackLoaderOptions(
  options: ReturnType<typeof buildSourceInspectorLoaderOptions>
): TurbopackObjectLoader["options"] {
  return {
    attributeName: options.attributeName,
    wrapLooseTextNodes: options.wrapLooseTextNodes,
    annotateLeafNodesOnly: options.annotateLeafNodesOnly,
    includePaths: options.includePaths,
  };
}

function mergeRuleEntry(
  existing: TurbopackRuleConfigCollection | undefined,
  incoming: TurbopackRuleCollectionItem
): TurbopackRuleConfigCollection {
  if (!existing) {
    return isTurbopackRule(incoming) ? incoming : [incoming];
  }
  if (Array.isArray(existing)) {
    return [...existing, incoming] as TurbopackRuleConfigCollection;
  }
  return [existing, incoming] as TurbopackRuleConfigCollection;
}

function mergeRules(
  currentRules: TurbopackRules | undefined,
  incomingRules: TurbopackRules
): TurbopackRules {
  const merged: TurbopackRules = {
    ...(currentRules ?? {}),
  };

  for (const [glob, rule] of Object.entries(incomingRules)) {
    if (Array.isArray(rule)) {
      for (const ruleEntry of rule) {
        merged[glob] = mergeRuleEntry(merged[glob], ruleEntry);
      }
      continue;
    }
    merged[glob] = mergeRuleEntry(merged[glob], rule);
  }

  return merged;
}

function createLegacyTurboLoaders(options: NextjsTurbopackOptions, cwd: string) {
  const loaderOptions = buildSourceInspectorLoaderOptions(options, cwd);
  const loader: TurbopackObjectLoader = {
    loader: SOURCE_INSPECTOR_LOADER,
    options: toTurbopackLoaderOptions(loaderOptions),
  };

  return TURBOPACK_EXTENSIONS.reduce<Record<string, TurbopackLoader[]>>((acc, extension) => {
    acc[extension] = [loader];
    return acc;
  }, {});
}

export function createSourceInspectorTurbopackRules(
  options: NextjsTurbopackOptions = {},
  cwd: string = options.cwd ?? process.cwd(),
  rootDir: string = findWorkspaceRoot(cwd)
): TurbopackRules {
  if (!isSourceInspectorEnabled(options)) {
    return {};
  }

  const loaderOptions = buildSourceInspectorLoaderOptions(options, cwd);
  const loader: TurbopackObjectLoader = {
    loader: SOURCE_INSPECTOR_LOADER,
    options: toTurbopackLoaderOptions(loaderOptions),
  };

  const includePathConditions = loaderOptions.includePaths.map((includePath) => ({
    path: toTurbopackPathCondition(includePath, rootDir),
  }));

  const includeCondition =
    includePathConditions.length === 1 ? includePathConditions[0] : { any: includePathConditions };

  const rule: TurbopackRule = {
    condition: { all: [{ not: "foreign" }, includeCondition] },
    loaders: [loader],
  };

  return {
    "*": rule,
  };
}

export function applySourceInspectorTurbopack<TConfig extends NextJsLikeConfig>(
  nextConfig: TConfig,
  options: NextjsTurbopackOptions = {}
): TConfig & NextJsLikeConfig {
  if (!isSourceInspectorEnabled(options)) {
    return nextConfig;
  }

  const cwd = options.cwd ?? process.cwd();
  const resolvedRoot = resolveTurbopackRoot(nextConfig, cwd);
  const rules = createSourceInspectorTurbopackRules(options, cwd, resolvedRoot);

  if (Object.keys(rules).length === 0) {
    return nextConfig;
  }

  if (nextConfig.turbopack) {
    return {
      ...nextConfig,
      turbopack: {
        ...nextConfig.turbopack,
        root: nextConfig.turbopack.root ?? resolvedRoot,
        rules: mergeRules(nextConfig.turbopack.rules, rules),
      },
    };
  }

  if (nextConfig.experimental?.turbo) {
    const legacyTurbo = nextConfig.experimental.turbo;
    const hasLegacyLoaders =
      legacyTurbo &&
      typeof legacyTurbo === "object" &&
      "loaders" in legacyTurbo &&
      typeof legacyTurbo.loaders === "object" &&
      legacyTurbo.loaders !== null;

    const mergedTurbo: LegacyTurboConfig = hasLegacyLoaders
      ? {
          ...legacyTurbo,
          root: legacyTurbo.root ?? resolvedRoot,
          loaders: {
            ...legacyTurbo.loaders,
            ...createLegacyTurboLoaders(options, cwd),
          },
        }
      : {
          ...legacyTurbo,
          root: legacyTurbo.root ?? resolvedRoot,
          rules: mergeRules(legacyTurbo.rules, rules),
        };

    return {
      ...nextConfig,
      experimental: {
        ...nextConfig.experimental,
        turbo: mergedTurbo,
      },
    };
  }

  return {
    ...nextConfig,
    turbopack: {
      root: resolvedRoot,
      rules,
    },
  };
}
