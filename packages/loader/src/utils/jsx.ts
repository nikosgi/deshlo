import * as t from "@babel/types";

export function isHostElement(
  nameNode: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName
): boolean {
  return t.isJSXIdentifier(nameNode) && /^[a-z]/.test(nameNode.name);
}

export function hasJsxElementChildren(node: t.JSXElement): boolean {
  return node.children.some((child) => t.isJSXElement(child) || t.isJSXFragment(child));
}
