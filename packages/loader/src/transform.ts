import * as parser from "@babel/parser";
import generate from "@babel/generator";
import traverse, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";

import { BABEL_PARSER_PLUGINS } from "./constants";
import { hasJsxElementChildren, isHostElement } from "./utils/jsx";
import { toRelativePath } from "./utils/path";
import { advanceLocation, splitMeaningfulText } from "./utils/text";

export interface TransformOptions {
  attributeName: string;
  wrapLooseTextNodes: boolean;
  annotateLeafNodesOnly: boolean;
}

export interface TransformResult {
  code: string;
  map: unknown;
  changed: boolean;
}

export function transformSource(
  source: string,
  resourcePath: string,
  options: TransformOptions
): TransformResult {
  if (typeof source !== "string" || !source.includes("<")) {
    return { code: source, map: null, changed: false };
  }

  let ast: t.File;
  try {
    ast = parser.parse(source, {
      sourceType: "unambiguous",
      errorRecovery: true,
      plugins: [...BABEL_PARSER_PLUGINS],
    });
  } catch {
    return { code: source, map: null, changed: false };
  }

  const relativePath = toRelativePath(resourcePath);
  let changed = false;

  traverse(ast, {
    JSXOpeningElement(openingPath: NodePath<t.JSXOpeningElement>) {
      const nameNode = openingPath.node.name;

      if (!isHostElement(nameNode)) {
        return;
      }

      if (!openingPath.node.loc) {
        return;
      }

      if (options.annotateLeafNodesOnly) {
        const parentNode = openingPath.parentPath.node;
        if (t.isJSXElement(parentNode) && hasJsxElementChildren(parentNode)) {
          return;
        }
      }

      const hasSourceAttribute = openingPath.node.attributes.some(
        (attribute) =>
          t.isJSXAttribute(attribute) &&
          t.isJSXIdentifier(attribute.name, { name: options.attributeName })
      );

      if (hasSourceAttribute) {
        return;
      }

      const { line, column } = openingPath.node.loc.start;
      const locationValue = `${relativePath}:${line}:${column + 1}`;

      if (!hasSourceAttribute) {
        openingPath.node.attributes.push(
          t.jsxAttribute(t.jsxIdentifier(options.attributeName), t.stringLiteral(locationValue))
        );
        changed = true;
      }
    },
    JSXElement(elementPath: NodePath<t.JSXElement>) {
      if (!options.wrapLooseTextNodes) {
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
              t.jsxAttribute(t.jsxIdentifier(options.attributeName), t.stringLiteral(locationValue)),
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
