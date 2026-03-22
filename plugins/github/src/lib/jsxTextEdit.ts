import * as parser from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

import { SourceInspectorError } from "./errors";
import { normalizeTextForComparison } from "./sourceLoc";
import type { ParsedSourceLoc } from "./types";

export interface ApplyTextReplacementInput {
  sourceCode: string;
  sourceLoc: ParsedSourceLoc;
  tagName: string;
  selectedText: string;
  proposedText: string;
}

export interface ApplyTextReplacementResult {
  updatedSourceCode: string;
  oldText: string;
  newText: string;
}

interface MatchedOpeningElement {
  node: t.JSXOpeningElement;
  start: number;
}

function findMatchedOpeningElement(
  sourceCode: string,
  sourceLoc: ParsedSourceLoc,
  tagName: string
): MatchedOpeningElement {
  let ast;

  try {
    ast = parser.parse(sourceCode, {
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
    throw new SourceInspectorError("INVALID_SOURCE_LOC", "Unable to parse source file.");
  }

  const matches: MatchedOpeningElement[] = [];

  traverse(ast, {
    JSXOpeningElement(path) {
      const nameNode = path.node.name;

      if (!t.isJSXIdentifier(nameNode)) {
        return;
      }

      if (!path.node.loc || typeof path.node.start !== "number") {
        return;
      }

      const nodeLine = path.node.loc.start.line;
      const nodeColumnOneBased = path.node.loc.start.column + 1;

      if (
        nodeLine === sourceLoc.line &&
        nodeColumnOneBased === sourceLoc.column &&
        nameNode.name === tagName
      ) {
        matches.push({
          node: path.node,
          start: path.node.start,
        });
      }
    },
  });

  if (matches.length !== 1) {
    throw new SourceInspectorError(
      "INVALID_SOURCE_LOC",
      "Unable to map selected element to a unique JSX tag in source file."
    );
  }

  return matches[0];
}

function replaceTrimmedPortion(rawText: string, replacement: string): string {
  const trimmed = rawText.trim();

  if (!trimmed) {
    throw new SourceInspectorError("NON_TEXT_NODE", "Selected element does not contain editable text.");
  }

  const first = rawText.indexOf(trimmed);
  const last = rawText.lastIndexOf(trimmed);

  if (first === -1 || first !== last) {
    throw new SourceInspectorError(
      "NON_TEXT_NODE",
      "Selected element text is ambiguous and cannot be replaced safely."
    );
  }

  return `${rawText.slice(0, first)}${replacement}${rawText.slice(first + trimmed.length)}`;
}

export function applyTextReplacement({
  sourceCode,
  sourceLoc,
  tagName,
  selectedText,
  proposedText,
}: ApplyTextReplacementInput): ApplyTextReplacementResult {
  const matchedOpening = findMatchedOpeningElement(sourceCode, sourceLoc, tagName);

  let ast;
  try {
    ast = parser.parse(sourceCode, {
      sourceType: "unambiguous",
      errorRecovery: true,
      plugins: ["jsx", "typescript", "classProperties", "classPrivateProperties", "classPrivateMethods"],
    });
  } catch {
    throw new SourceInspectorError("INVALID_SOURCE_LOC", "Unable to parse source file.");
  }

  let targetChildren: t.JSXElement["children"] | null = null;

  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      if (typeof opening.start !== "number") {
        return;
      }

      if (opening.start === matchedOpening.start) {
        targetChildren = path.node.children;
        path.stop();
      }
    },
  });

  if (!targetChildren) {
    throw new SourceInspectorError("INVALID_SOURCE_LOC", "Unable to locate selected JSX element.");
  }

  const resolvedChildren = targetChildren as Array<
    t.JSXText | t.JSXExpressionContainer | t.JSXSpreadChild | t.JSXElement | t.JSXFragment
  >;

  const unsupportedChild = resolvedChildren.some((child) => !t.isJSXText(child));
  if (unsupportedChild) {
    throw new SourceInspectorError(
      "NON_TEXT_NODE",
      "Selected element contains nested or dynamic children. Select a simple text element."
    );
  }

  const meaningfulTextNodes = resolvedChildren.filter(
    (child): child is t.JSXText => t.isJSXText(child) && child.value.trim().length > 0
  );

  if (meaningfulTextNodes.length !== 1) {
    throw new SourceInspectorError(
      "NON_TEXT_NODE",
      "Selected element must contain exactly one direct text segment."
    );
  }

  const textNode = meaningfulTextNodes[0];

  if (typeof textNode.start !== "number" || typeof textNode.end !== "number") {
    throw new SourceInspectorError("INVALID_SOURCE_LOC", "Unable to map selected text node offsets.");
  }

  const rawText = sourceCode.slice(textNode.start, textNode.end);
  const oldText = rawText.trim();

  if (normalizeTextForComparison(oldText) !== normalizeTextForComparison(selectedText)) {
    throw new SourceInspectorError(
      "TEXT_MISMATCH",
      "Selected DOM text no longer matches source. Refresh and try again."
    );
  }

  if (oldText === proposedText.trim()) {
    throw new SourceInspectorError("NO_DIFF", "No effective change detected.");
  }

  const replacementRawText = replaceTrimmedPortion(rawText, proposedText.trim());

  const updatedSourceCode =
    sourceCode.slice(0, textNode.start) + replacementRawText + sourceCode.slice(textNode.end);

  return {
    updatedSourceCode,
    oldText,
    newText: proposedText.trim(),
  };
}
