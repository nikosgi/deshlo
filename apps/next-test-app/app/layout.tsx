import type { Metadata } from "next";
import { GitHubBrowserPluginConfig, GithubPlugin } from "@deshlo/react-github";
import { OverlayGate } from "@deshlo/react/overlay";

import "./globals.css";

export const metadata: Metadata = {
  title: "Source Inspector Test App",
  description: "App Router playground for @deshlo/nextjs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const enabled = process.env.NEXT_PUBLIC_SOURCE_INSPECTOR === "1";
  const githubToken =
    process.env.GITHUB_TOKEN || process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_GITHUB_TOKEN;
  const hostConfig =
    process.env.SOURCE_INSPECTOR_HOST_CONFIG || process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_HOST_CONFIG;
  const githubPathPrefix =
    process.env.SOURCE_INSPECTOR_GITHUB_PATH_PREFIX ||
    process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_GITHUB_PATH_PREFIX;
  const branchPrefix =
    process.env.SOURCE_INSPECTOR_BRANCH_PREFIX ||
    process.env.NEXT_PUBLIC_SOURCE_INSPECTOR_BRANCH_PREFIX;

  const config = {
    token: githubToken,
    hostConfig,
    githubPathPrefix,
    branchPrefix,
  } satisfies GitHubBrowserPluginConfig

  return (
    <html lang="en">
      <body>
        <GithubPlugin config={config}>
          <OverlayGate enabled={enabled} />
        </GithubPlugin>
        {children}
      </body>
    </html>
  );
}
