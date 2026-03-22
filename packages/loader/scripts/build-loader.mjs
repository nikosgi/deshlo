import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const currentFile = fileURLToPath(import.meta.url);
const packageDir = path.resolve(path.dirname(currentFile), "..");
const sourceEntryPath = path.join(packageDir, "src", "index.ts");
const outputLoaderPath = path.join(packageDir, "jsx-source-loader.cjs");
const outputTypesPath = path.join(packageDir, "index.d.ts");

await build({
  entryPoints: [sourceEntryPath],
  outfile: outputLoaderPath,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: ["node18"],
  external: ["@babel/parser", "@babel/generator", "@babel/traverse", "@babel/types"],
  sourcemap: false,
  legalComments: "none",
});

if (!existsSync(outputTypesPath)) {
  throw new Error(`Missing loader type declaration at ${outputTypesPath}`);
}
