"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/constants.ts
var DEFAULT_ATTRIBUTE_NAME = "data-src-loc";
var DEFAULT_REVISION_ATTRIBUTE_NAME = "data-src-rev";
var BABEL_PARSER_PLUGINS = [
  "jsx",
  "typescript",
  "classProperties",
  "classPrivateProperties",
  "classPrivateMethods",
  "dynamicImport",
  "importMeta",
  "topLevelAwait"
];

// src/transform.ts
var parser = __toESM(require("@babel/parser"));
var import_generator = __toESM(require("@babel/generator"));
var import_traverse = __toESM(require("@babel/traverse"));
var t2 = __toESM(require("@babel/types"));

// src/utils/jsx.ts
var t = __toESM(require("@babel/types"));
function isHostElement(nameNode) {
  return t.isJSXIdentifier(nameNode) && /^[a-z]/.test(nameNode.name);
}
function hasJsxElementChildren(node) {
  return node.children.some((child) => t.isJSXElement(child) || t.isJSXFragment(child));
}

// src/utils/path.ts
var import_node_path = __toESM(require("node:path"));
function toRelativePath(absolutePath, cwd = process.cwd()) {
  return import_node_path.default.relative(cwd, absolutePath).replace(/\\/g, "/");
}

// src/utils/text.ts
function splitMeaningfulText(value) {
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
    trailing: value.slice(lastNonWhitespace + 1)
  };
}
function advanceLocation(start, value) {
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

// src/transform.ts
function transformSource(source, resourcePath, options) {
  if (typeof source !== "string" || !source.includes("<")) {
    return { code: source, map: null, changed: false };
  }
  let ast;
  try {
    ast = parser.parse(source, {
      sourceType: "unambiguous",
      errorRecovery: true,
      plugins: [...BABEL_PARSER_PLUGINS]
    });
  } catch {
    return { code: source, map: null, changed: false };
  }
  const relativePath = toRelativePath(resourcePath);
  let changed = false;
  (0, import_traverse.default)(ast, {
    JSXOpeningElement(openingPath) {
      const nameNode = openingPath.node.name;
      if (!isHostElement(nameNode)) {
        return;
      }
      if (!openingPath.node.loc) {
        return;
      }
      if (options.annotateLeafNodesOnly) {
        const parentNode = openingPath.parentPath.node;
        if (t2.isJSXElement(parentNode) && hasJsxElementChildren(parentNode)) {
          return;
        }
      }
      const hasSourceAttribute = openingPath.node.attributes.some(
        (attribute) => t2.isJSXAttribute(attribute) && t2.isJSXIdentifier(attribute.name, { name: options.attributeName })
      );
      const hasRevisionAttribute = openingPath.node.attributes.some(
        (attribute) => t2.isJSXAttribute(attribute) && t2.isJSXIdentifier(attribute.name, { name: options.revisionAttributeName })
      );
      if (hasSourceAttribute && hasRevisionAttribute) {
        return;
      }
      const { line, column } = openingPath.node.loc.start;
      const locationValue = `${relativePath}:${line}:${column + 1}`;
      if (!hasSourceAttribute) {
        openingPath.node.attributes.push(
          t2.jsxAttribute(t2.jsxIdentifier(options.attributeName), t2.stringLiteral(locationValue))
        );
        changed = true;
      }
      if (!hasRevisionAttribute) {
        openingPath.node.attributes.push(
          t2.jsxAttribute(
            t2.jsxIdentifier(options.revisionAttributeName),
            t2.stringLiteral(options.revisionValue)
          )
        );
        changed = true;
      }
    },
    JSXElement(elementPath) {
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
        (child) => t2.isJSXElement(child) || t2.isJSXFragment(child) || t2.isJSXExpressionContainer(child)
      );
      if (!hasNonTextSiblings) {
        return;
      }
      const nextChildren = [];
      let wrappedAnyTextNode = false;
      for (const child of children) {
        if (!t2.isJSXText(child) || !child.loc) {
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
          nextChildren.push(t2.jsxText(parts.leading));
        }
        nextChildren.push(
          t2.jsxElement(
            t2.jsxOpeningElement(t2.jsxIdentifier("span"), [
              t2.jsxAttribute(t2.jsxIdentifier(options.attributeName), t2.stringLiteral(locationValue)),
              t2.jsxAttribute(
                t2.jsxIdentifier(options.revisionAttributeName),
                t2.stringLiteral(options.revisionValue)
              )
            ]),
            t2.jsxClosingElement(t2.jsxIdentifier("span")),
            [t2.jsxText(parts.text)],
            false
          )
        );
        if (parts.trailing.length > 0) {
          nextChildren.push(t2.jsxText(parts.trailing));
        }
        wrappedAnyTextNode = true;
        changed = true;
      }
      if (wrappedAnyTextNode) {
        elementPath.node.children = nextChildren;
      }
    }
  });
  if (!changed) {
    return { code: source, map: null, changed: false };
  }
  const output = (0, import_generator.default)(
    ast,
    {
      sourceMaps: true,
      sourceFileName: relativePath,
      jsescOption: { minimal: true }
    },
    source
  );
  return {
    code: output.code,
    map: output.map,
    changed: true
  };
}

// src/utils/commit.ts
var import_node_child_process = require("node:child_process");
var COMMIT_ENV_KEYS = [
  "COMMIT_SHA",
  "SOURCE_VERSION",
  "GITHUB_SHA",
  "CI_COMMIT_SHA",
  "GIT_COMMIT",
  "VERCEL_GIT_COMMIT_SHA",
  "RENDER_GIT_COMMIT"
];
var cachedCommitSha = null;
function resolveCommitFromEnv() {
  for (const key of COMMIT_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}
function resolveCommitFromGit() {
  try {
    const value = (0, import_node_child_process.execSync)("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
function resolveBuildCommitSha() {
  if (cachedCommitSha) {
    return cachedCommitSha;
  }
  const resolved = resolveCommitFromEnv() ?? resolveCommitFromGit() ?? "unknown";
  cachedCommitSha = resolved;
  return resolved;
}

// src/index.ts
function normalizeOptions(options) {
  return {
    attributeName: typeof options.attributeName === "string" && options.attributeName.trim().length > 0 ? options.attributeName.trim() : DEFAULT_ATTRIBUTE_NAME,
    revisionAttributeName: DEFAULT_REVISION_ATTRIBUTE_NAME,
    revisionValue: resolveBuildCommitSha(),
    wrapLooseTextNodes: options.wrapLooseTextNodes === true,
    annotateLeafNodesOnly: options.annotateLeafNodesOnly === true
  };
}
function jsxSourceLoader(source, inputSourceMap) {
  const callback = this.async();
  const loaderOptions = typeof this.getOptions === "function" ? this.getOptions() ?? {} : {};
  const normalizedOptions = normalizeOptions(loaderOptions);
  const output = transformSource(source, this.resourcePath, normalizedOptions);
  if (!output.changed) {
    callback(null, source, inputSourceMap);
    return;
  }
  callback(null, output.code, output.map ?? inputSourceMap);
}
module.exports = jsxSourceLoader;
