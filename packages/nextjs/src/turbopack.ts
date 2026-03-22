import { existsSync } from "node:fs";
import path from "node:path";

import {
  buildSourceInspectorLoaderOptions,
  isSourceInspectorEnabled,
  type SourceInspectorAdapterOptions,
} from "@deshlo/core";

export interface NextJsLikeConfig {
  webpack?: (config: any, context: any) => any;
  turbopack?: NextTurbopackConfig;
  experimental?: {
    turbo?: LegacyTurboConfig;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface NextjsTurbopackOptions extends SourceInspectorAdapterOptions {
  cwd?: string;
}

export type TurbopackLoader = string | { loader: string; options?: unknown };

export interface TurbopackRule {
  loaders: TurbopackLoader[];
  as?: string;
  condition?: unknown;
}

export type TurbopackRules = Record<string, TurbopackRule | TurbopackRule[]>;

export interface NextTurbopackConfig {
  root?: string;
  rules?: TurbopackRules;
  [key: string]: unknown;
}

export interface LegacyTurboConfig {
  root?: string;
  rules?: TurbopackRules;
  loaders?: Record<string, TurbopackLoader[]>;
  [key: string]: unknown;
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

function toTurbopackGlob(includePath: string, rootDir: string, extension: string): string {
  const relativePath = toPosixPath(path.relative(rootDir, includePath)).replace(/^\.\/+/, "");
  if (relativePath.length === 0 || relativePath === ".") {
    return `*${extension}`;
  }
  if (relativePath.startsWith("../")) {
    return `**/*${extension}`;
  }
  return `${relativePath}/**/*${extension}`;
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

function mergeRuleEntry(
  existing: TurbopackRule | TurbopackRule[] | undefined,
  incoming: TurbopackRule
): TurbopackRule | TurbopackRule[] {
  if (!existing) {
    return incoming;
  }
  if (Array.isArray(existing)) {
    return [...existing, incoming];
  }
  return [existing, incoming];
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
  const loader = {
    loader: SOURCE_INSPECTOR_LOADER,
    options: loaderOptions,
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
  const loader = {
    loader: SOURCE_INSPECTOR_LOADER,
    options: loaderOptions,
  };

  const rules: TurbopackRules = {};
  for (const includePath of loaderOptions.includePaths) {
    for (const extension of TURBOPACK_EXTENSIONS) {
      const glob = toTurbopackGlob(includePath, rootDir, extension);
      const incomingRule: TurbopackRule = {
        condition: { not: "foreign" },
        loaders: [loader],
        as: "*.js",
      };
      rules[glob] = mergeRuleEntry(rules[glob], incomingRule);
    }
  }

  return rules;
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
