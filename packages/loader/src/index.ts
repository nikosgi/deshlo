import { DEFAULT_ATTRIBUTE_NAME, DEFAULT_REVISION_ATTRIBUTE_NAME } from "./constants";
import { transformSource } from "./transform";
import { resolveBuildCommitSha } from "./utils/commit";

interface LoaderOptions {
  attributeName?: string;
  wrapLooseTextNodes?: boolean;
  annotateLeafNodesOnly?: boolean;
}

type LoaderCallback = (error: Error | null, source?: string, sourceMap?: unknown) => void;

interface LoaderContext {
  async(): LoaderCallback;
  getOptions?: () => LoaderOptions;
  resourcePath: string;
}

function normalizeOptions(options: LoaderOptions) {
  return {
    attributeName:
      typeof options.attributeName === "string" && options.attributeName.trim().length > 0
        ? options.attributeName.trim()
        : DEFAULT_ATTRIBUTE_NAME,
    revisionAttributeName: DEFAULT_REVISION_ATTRIBUTE_NAME,
    revisionValue: resolveBuildCommitSha(),
    wrapLooseTextNodes: true,
    annotateLeafNodesOnly: true,
  };
}

function jsxSourceLoader(this: LoaderContext, source: string, inputSourceMap?: unknown): void {
  const callback = this.async();
  const loaderOptions =
    typeof this.getOptions === "function" ? this.getOptions() ?? {} : ({} as LoaderOptions);
  const normalizedOptions = normalizeOptions(loaderOptions);

  const output = transformSource(source, this.resourcePath, normalizedOptions);

  if (!output.changed) {
    callback(null, source, inputSourceMap);
    return;
  }

  callback(null, output.code, output.map ?? inputSourceMap);
}

export = jsxSourceLoader;
