import { AnnotationProviderError } from "./errors";

export interface HostRepoConfig {
  apiBaseUrl?: string;
  owner: string;
  repo: string;
  defaultBaseBranch?: string;
}

export interface ResolvedRepoConfig extends HostRepoConfig {
  host: string;
  apiBaseUrl: string;
}

const HOST_CONFIG_ENV = "NEXT_PUBLIC_DESHLO_ANNOTATIONS_HOST_CONFIG";
const LEGACY_HOST_CONFIG_ENV = "NEXT_PUBLIC_SOURCE_INSPECTOR_HOST_CONFIG";

export type HostConfigInput = string | Record<string, HostRepoConfig>;

function parseHostConfig(raw: string): Record<string, HostRepoConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AnnotationProviderError("UNMAPPED_HOST", `${HOST_CONFIG_ENV} must be valid JSON.`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AnnotationProviderError(
      "UNMAPPED_HOST",
      `${HOST_CONFIG_ENV} must be an object keyed by host.`
    );
  }

  return parsed as Record<string, HostRepoConfig>;
}

function parseHostConfigInput(input?: HostConfigInput): Record<string, HostRepoConfig> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input;
  }

  const raw =
    (typeof input === "string" ? input : process.env[HOST_CONFIG_ENV]) ||
    process.env[LEGACY_HOST_CONFIG_ENV];

  if (!raw) {
    throw new AnnotationProviderError(
      "UNMAPPED_HOST",
      `${HOST_CONFIG_ENV} is not configured.`
    );
  }

  return parseHostConfig(raw);
}

function stripPort(host: string): string {
  const index = host.indexOf(":");
  if (index === -1) {
    return host;
  }

  return host.slice(0, index);
}

function validateHostConfig(host: string, config: HostRepoConfig): ResolvedRepoConfig {
  if (!config || typeof config !== "object") {
    throw new AnnotationProviderError(
      "UNMAPPED_HOST",
      `Missing repository configuration for host ${host}.`
    );
  }

  if (!config.owner || !config.repo) {
    throw new AnnotationProviderError(
      "UNMAPPED_HOST",
      `Host config for ${host} must include owner and repo.`
    );
  }

  return {
    ...config,
    host,
    apiBaseUrl: config.apiBaseUrl?.trim() || "https://api.github.com",
  };
}

export function resolveRepoConfigForCurrentHost(
  hostOverride?: string,
  hostConfigInput?: HostConfigInput
): ResolvedRepoConfig {
  const host = (hostOverride || "").trim().toLowerCase();
  if (!host) {
    throw new AnnotationProviderError("UNMAPPED_HOST", "Unable to infer current host.");
  }

  const withoutPort = stripPort(host);
  const mapping = parseHostConfigInput(hostConfigInput);

  const config = mapping[host] ?? mapping[withoutPort];
  if (!config) {
    throw new AnnotationProviderError(
      "UNMAPPED_HOST",
      `No annotations host mapping found for host ${host}.`
    );
  }

  return validateHostConfig(host, config);
}
