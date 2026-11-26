import type Parser from "tree-sitter";
import type { SourceLocation } from "./types.js";

export type SyntaxNode = Parser.SyntaxNode;
export type QueryMatch = Parser.QueryMatch;
export type QueryCapture = Parser.QueryCapture;

export function toLocation(node: SyntaxNode): SourceLocation {
  return {
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
  };
}

export function collapseWhitespace(value: string, maxLength = 300): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

export function cleanIdentifier(value: string): string {
  return value.replace(/^[#*&]+/, "").trim();
}

export function stripCommentMarkers(value: string): string {
  const lines = value
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^\/\*\*+/, "")
        .replace(/^\/\*+/, "")
        .replace(/^\*+\/?/, "")
        .replace(/^\/\/\//, "")
        .replace(/^\/\//, "")
        .replace(/^#!?/, "")
        .replace(/\*\/$/, "")
        .replace(/^\*\s?/, "")
        .trim(),
    )
    .filter((line) => line.length > 0);
  return lines.join("\n").trim();
}

export function firstSummary(value: string, maxLength = 200): string {
  const first = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (first === undefined) return "";
  return first.length > maxLength ? `${first.slice(0, maxLength - 1)}…` : first;
}

export function childOfType(node: SyntaxNode, types: readonly string[]): SyntaxNode | null {
  for (const child of node.namedChildren) {
    if (types.includes(child.type)) return child;
  }
  return null;
}

export function childByField(node: SyntaxNode, names: readonly string[]): SyntaxNode | null {
  for (const name of names) {
    const child = node.childForFieldName(name);
    if (child !== null) return child;
  }
  return null;
}

/** Bounded breadth-first search used for small, structural lookups only. */
export function findDescendant(
  root: SyntaxNode,
  types: readonly string[],
  maxNodes = 5_000,
): SyntaxNode | null {
  const queue: SyntaxNode[] = [root];
  let visited = 0;
  while (queue.length > 0 && visited < maxNodes) {
    const node = queue.shift();
    if (node === undefined) break;
    visited += 1;
    if (types.includes(node.type)) return node;
    queue.push(...node.namedChildren);
  }
  return null;
}

export function closestAncestor(node: SyntaxNode, types: readonly string[]): SyntaxNode | null {
  let current = node.parent;
  while (current !== null) {
    if (types.includes(current.type)) return current;
    current = current.parent;
  }
  return null;
}

export function stableSymbolId(kind: string, name: string, location: SourceLocation): string {
  return `${kind}:${name}:${location.startIndex}:${location.endIndex}`;
}
