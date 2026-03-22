"use client";

import type { ReactNode } from "react";

import {
  createGitHubBrowserPlugin,
  type GitHubBrowserPluginConfig,
} from "@deshlo/plugin-github";
import { OverlayPluginProvider } from "@deshlo/react/overlay";

export interface GithubPluginProps {
  config?: GitHubBrowserPluginConfig;
  children: ReactNode;
}

export function GithubPlugin({ children, config }: GithubPluginProps) {
  const plugin = createGitHubBrowserPlugin(config || {});

  return <OverlayPluginProvider plugin={plugin}>{children}</OverlayPluginProvider>;
}

export type { GitHubBrowserPluginConfig };
