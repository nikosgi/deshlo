"use client";

import type { ReactNode } from "react";

import {
  createGitHubAnnotationsPlugin,
  type GitHubAnnotationsPluginConfig,
} from "@deshlo/plugin-github-annotations";

import { AnnotationPluginProvider } from "./annotation-plugin-provider";

export interface GithubAnnotationsPluginProps {
  config?: GitHubAnnotationsPluginConfig;
  children: ReactNode;
}

export function GithubAnnotationsPlugin({ config, children }: GithubAnnotationsPluginProps) {
  const plugin = createGitHubAnnotationsPlugin(config || {});
  return <AnnotationPluginProvider plugin={plugin}>{children}</AnnotationPluginProvider>;
}

export type { GitHubAnnotationsPluginConfig };
