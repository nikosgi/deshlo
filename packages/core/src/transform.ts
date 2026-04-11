import path from "node:path";
import * as parser from "@babel/parser";
import generate from "@babel/generator";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

import { DEFAULT_ATTRIBUTE_NAME } from "./shared";

export interface InjectSourceAttributesOptions {
  attributeName?: string;
  cwd?: string;
  wrapLooseTextNodes?: boolean;
  annotateLeafNodesOnly?: boolean;
}

export interface InjectSourceAttributesResult {
  code: string;
  map: unknown;
  changed: boolean;
}

function toRelativePath(absolutePath: string, cwd: string): string {
  return path.relative(cwd, absolutePath).replace(/\\/g, "/");
}

function splitMeaningfulText(
  value: string
): { leading: string; text: string; trailing: string } | null {
  let firstNonWhitespace = -1;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index].trim() !== "") {
      firstNonWhitespace = index;
      break;
    }
  }

  if (firstNonWhitespace === -1) {
    return null;
  }

  let lastNonWhitespace = -1;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index].trim() !== "") {
      lastNonWhitespace = index;
      break;
    }
  }

  if (lastNonWhitespace === -1) {
    return null;
  }

  return {
    leading: value.slice(0, firstNonWhitespace),
    text: value.slice(firstNonWhitespace, lastNonWhitespace + 1),
    trailing: value.slice(lastNonWhitespace + 1),
  };
}

function advanceLocation(
  start: { line: number; column: number },
  value: string
): { line: number; column: number } {
  let line = start.line;
  let column = start.column;

  for (const character of value) {
    if (character === "\n") {
      line += 1;
      column = 0;
      continue;
    }

    if (character === "\r") {
      continue;
    }

    column += 1;
  }

  return { line, column };
}

function isHostElement(nameNode: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): boolean {
  return t.isJSXIdentifier(nameNode) && /^[a-z]/.test(nameNode.name);
}

function hasJsxElementChildren(node: t.JSXElement): boolean {
  return node.children.some((child) => t.isJSXElement(child) || t.isJSXFragment(child));
}

export function injectSourceAttributes(
  source: string,
  resourcePath: string,
  options: InjectSourceAttributesOptions = {}
): InjectSourceAttributesResult {
  const attributeName =
    typeof options.attributeName === "string" && options.attributeName.trim().length > 0
      ? options.attributeName.trim()
      : DEFAULT_ATTRIBUTE_NAME;

  if (typeof source !== "string" || !source.includes("<")) {
    return { code: source, map: null, changed: false };
  }

  const cwd = options.cwd ?? process.cwd();
  const relativePath = toRelativePath(resourcePath, cwd);
  const wrapLooseTextNodes = options.wrapLooseTextNodes === true;
  const annotateLeafNodesOnly = options.annotateLeafNodesOnly === true;

  let ast;
  try {
    ast = parser.parse(source, {
      sourceType: "unambiguous",
      errorRecovery: true,
      plugins: [
        "jsx",
        "typescript",
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
        "dynamicImport",
        "importMeta",
        "topLevelAwait",
      ],
    });
  } catch {
    return { code: source, map: null, changed: false };
  }

  let changed = false;

  traverse(ast, {
    JSXOpeningElement(openingPath) {
      const nameNode = openingPath.node.name;

      if (!isHostElement(nameNode)) {
        return;
      }

      if (!openingPath.node.loc) {
        return;
      }

      if (annotateLeafNodesOnly) {
        const parentNode = openingPath.parentPath.node;
        if (t.isJSXElement(parentNode) && hasJsxElementChildren(parentNode)) {
          return;
        }
      }

      const hasSourceAttribute = openingPath.node.attributes.some(
        (attribute) =>
          t.isJSXAttribute(attribute) &&
          t.isJSXIdentifier(attribute.name, { name: attributeName })
      );

      if (hasSourceAttribute) {
        return;
      }

      const { line, column } = openingPath.node.loc.start;
      const locationValue = `${relativePath}:${line}:${column + 1}`;

      if (!hasSourceAttribute) {
        openingPath.node.attributes.push(
          t.jsxAttribute(t.jsxIdentifier(attributeName), t.stringLiteral(locationValue))
        );
        changed = true;
      }
    },
    JSXElement(elementPath) {
      if (!wrapLooseTextNodes) {
        return;
      }

      const nameNode = elementPath.node.openingElement.name;
      if (!isHostElement(nameNode)) {
        return;
      }

      const children = elementPath.node.children;
      if (children.length === 0) {
        return;
      }

      // Only wrap loose text when mixed with other child nodes.
      const hasNonTextSiblings = children.some(
        (child) =>
          t.isJSXElement(child) || t.isJSXFragment(child) || t.isJSXExpressionContainer(child)
      );
      if (!hasNonTextSiblings) {
        return;
      }

      const nextChildren: t.JSXElement["children"] = [];
      let wrappedAnyTextNode = false;

      for (const child of children) {
        if (!t.isJSXText(child) || !child.loc) {
          nextChildren.push(child);
          continue;
        }

        const parts = splitMeaningfulText(child.value);
        if (!parts) {
          nextChildren.push(child);
          continue;
        }

        const textStart = advanceLocation(
          { line: child.loc.start.line, column: child.loc.start.column },
          parts.leading
        );
        const locationValue = `${relativePath}:${textStart.line}:${textStart.column + 1}`;

        if (parts.leading.length > 0) {
          nextChildren.push(t.jsxText(parts.leading));
        }

        nextChildren.push(
          t.jsxElement(
            t.jsxOpeningElement(t.jsxIdentifier("span"), [
              t.jsxAttribute(t.jsxIdentifier(attributeName), t.stringLiteral(locationValue)),
            ]),
            t.jsxClosingElement(t.jsxIdentifier("span")),
            [t.jsxText(parts.text)],
            false
          )
        );

        if (parts.trailing.length > 0) {
          nextChildren.push(t.jsxText(parts.trailing));
        }

        wrappedAnyTextNode = true;
        changed = true;
      }

      if (wrappedAnyTextNode) {
        elementPath.node.children = nextChildren;
      }
    },
  });

  if (!changed) {
    return { code: source, map: null, changed: false };
  }

  const output = generate(
    ast,
    {
      sourceMaps: true,
      sourceFileName: relativePath,
      jsescOption: { minimal: true },
    },
    source
  );

  return {
    code: output.code,
    map: output.map,
    changed: true,
  };
}
