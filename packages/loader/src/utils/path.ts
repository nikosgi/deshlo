import path from "node:path";

export function toRelativePath(absolutePath: string, cwd: string = process.cwd()): string {
  return path.relative(cwd, absolutePath).replace(/\\/g, "/");
}
