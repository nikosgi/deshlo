import type { Metadata } from "next";
import { AnnotationGate, HttpAnnotationsPlugin, type HttpAnnotationsPluginConfig } from "@deshlo/annotations";
import { OverlayGate, GithubPlugin, type GitHubBrowserPluginConfig } from "deshlo";

import "./globals.css";

export const metadata: Metadata = {
  title: "Source Inspector Test App",
  description: "App Router playground for @deshlo/nextjs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const sourceInspectorEnabled = process.env.NEXT_PUBLIC_SOURCE_INSPECTOR === "1";
  const annotationsEnabled = process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS === "1";
  const annotationsApiBaseUrl =
    process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_API_BASE_URL ||
    process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_BASE_URL ||
    "http://localhost:8080";
  const annotationsApiKey = process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_API_KEY || "";
  const environment = process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_ENVIRONMENT;

  const githubToken =
    process.env.GITHUB_TOKEN || process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_GITHUB_TOKEN;
  const hostConfig =
    process.env.SOURCE_INSPECTOR_HOST_CONFIG ||
    process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_HOST_CONFIG;
  const branchPrefix =
    process.env.SOURCE_INSPECTOR_BRANCH_PREFIX ||
    process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_BRANCH_PREFIX;
  const annotationsConfig = {
    apiBaseUrl: annotationsApiBaseUrl,
    apiKey: annotationsApiKey,
    environment,
  } satisfies HttpAnnotationsPluginConfig;

  const sourceInspectorConfig = {
    token: githubToken,
    hostConfig,
    branchPrefix,
  } satisfies GitHubBrowserPluginConfig;

  return (
    <html lang="en">
      <body>
        {annotationsEnabled ? (
          <HttpAnnotationsPlugin config={annotationsConfig}>
            <AnnotationGate enabled />
          </HttpAnnotationsPlugin>
        ) : sourceInspectorEnabled ? (
          <GithubPlugin config={sourceInspectorConfig}>
            <OverlayGate enabled />
          </GithubPlugin>
        ) : null}
        {children}
      </body>
    </html>
  );
}
