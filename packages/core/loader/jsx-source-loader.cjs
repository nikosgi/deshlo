const path = require("node:path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const t = require("@babel/types");
const generate = require("@babel/generator").default;

const DEFAULT_ATTRIBUTE_NAME = "data-src-loc";

function toRelativePath(absolutePath) {
  return path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");
}

module.exports = function jsxSourceLoader(source, inputSourceMap) {
  const callback = this.async();
  const options = (typeof this.getOptions === "function" && this.getOptions()) || {};
  const attributeName =
    typeof options.attributeName === "string" && options.attributeName.trim().length > 0
      ? options.attributeName.trim()
      : DEFAULT_ATTRIBUTE_NAME;

  if (typeof source !== "string" || !source.includes("<")) {
    callback(null, source, inputSourceMap);
    return;
  }

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
  } catch (_error) {
    callback(null, source, inputSourceMap);
    return;
  }

  const relativePath = toRelativePath(this.resourcePath);
  let changed = false;

  traverse(ast, {
    JSXOpeningElement(openingPath) {
      const nameNode = openingPath.node.name;

      if (!t.isJSXIdentifier(nameNode)) {
        return;
      }

      // Inject only on host elements (div, input, section...) not component tags.
      if (!/^[a-z]/.test(nameNode.name)) {
        return;
      }

      if (!openingPath.node.loc) {
        return;
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

      openingPath.node.attributes.push(
        t.jsxAttribute(t.jsxIdentifier(attributeName), t.stringLiteral(locationValue))
      );
      changed = true;
    },
  });

  if (!changed) {
    callback(null, source, inputSourceMap);
    return;
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

  callback(null, output.code, output.map || inputSourceMap);
};
