import { isValidElement } from "react";
import { describe, expect, it } from "vitest";

import { OverlayPluginProvider } from "@deshlo/react/overlay";

import { GithubPlugin } from "./index";

describe("GithubPlugin", () => {
  it("wraps children in OverlayPluginProvider", () => {
    const element = GithubPlugin({
      config: { token: "ghp_test" },
      children: "child",
    }) as any;

    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(OverlayPluginProvider);
    expect(element.props.plugin.id).toBe("github-browser");
  });
});
