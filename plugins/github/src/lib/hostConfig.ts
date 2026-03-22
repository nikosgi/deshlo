import { SourceInspectorError } from "./errors";

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

const HOST_CONFIG_ENV = "NEXT_PUBLIC_SOURCE_INSPECTOR_HOST_CONFIG";

export type HostConfigInput = string | Record<string, HostRepoConfig>;

function parseHostConfig(raw: string): Record<string, HostRepoConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SourceInspectorError(
      "UNMAPPED_HOST",
      `${HOST_CONFIG_ENV} must be valid JSON.`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SourceInspectorError(
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

  const raw = typeof input === "string" ? input : process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_HOST_CONFIG;
  if (!raw) {
    throw new SourceInspectorError(
      "UNMAPPED_HOST",
      `${HOST_CONFIG_ENV} is not configured.`
    );
  }

  return parseHostConfig(raw);
}

function getCurrentHost(): string {
  if (typeof window === "undefined" || !window.location?.host) {
    throw new SourceInspectorError(
      "UNMAPPED_HOST",
      "Unable to infer current host in this runtime."
    );
  }
  const host = window.location.host.trim().toLowerCase();

  if (!host) {
    throw new SourceInspectorError("UNMAPPED_HOST", "Unable to infer current host.");
  }

  return host;
}

function stripPort(host: string): string {
  const portIndex = host.indexOf(":");
  if (portIndex === -1) {
    return host;
  }
  return host.slice(0, portIndex);
}

function validateHostConfig(host: string, config: HostRepoConfig): ResolvedRepoConfig {
  if (!config || typeof config !== "object") {
    throw new SourceInspectorError(
      "UNMAPPED_HOST",
      `Missing repository configuration for host ${host}.`
    );
  }

  if (!config.owner || !config.repo) {
    throw new SourceInspectorError(
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
  const host = (hostOverride || getCurrentHost()).trim().toLowerCase();
  const withoutPort = stripPort(host);
  const mapping = parseHostConfigInput(hostConfigInput);

  const config = mapping[host] ?? mapping[withoutPort];
  if (!config) {
    throw new SourceInspectorError(
      "UNMAPPED_HOST",
      `No source inspector repo mapping found for host ${host}.`
    );
  }

  return validateHostConfig(host, config);
}
