import { afterEach, describe, expect, it } from "vitest";

import { SourceInspectorError } from "../errors";
import { resolveRepoConfigForCurrentHost } from "../hostConfig";

const ENV_KEY = "NEXT_PUBLIC_SOURCE_INSPECTOR_HOST_CONFIG";

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("resolveRepoConfigForCurrentHost", () => {
  it("resolves host config and strips port for lookup", () => {
    process.env[ENV_KEY] = JSON.stringify({
      "example.com": {
        apiBaseUrl: "https://api.github.com",
        owner: "acme",
        repo: "demo",
        defaultBaseBranch: "main",
      },
    });

    const config = resolveRepoConfigForCurrentHost("example.com:3000");

    expect(config.host).toBe("example.com:3000");
    expect(config.owner).toBe("acme");
    expect(config.repo).toBe("demo");
    expect(config.defaultBaseBranch).toBe("main");
  });

  it("throws UNMAPPED_HOST when no host mapping exists", () => {
    process.env[ENV_KEY] = JSON.stringify({
      "example.com": {
        owner: "acme",
        repo: "demo",
      },
    });

    expect(() => resolveRepoConfigForCurrentHost("other.com")).toThrow(SourceInspectorError);
  });
});
