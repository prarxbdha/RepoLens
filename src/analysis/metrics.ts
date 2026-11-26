import type { CodeMetrics, FunctionMetric, LanguageDefinition, SymbolDeclaration } from "./types.js";
import { splitLines } from "../utils/encoding.js";
import type { SyntaxNode } from "./utils.js";

function isLogicalDecision(node: SyntaxNode, language: LanguageDefinition): boolean {
  if (node.type === "binary_expression" || node.type === "boolean_operator") {
    const text = node.text;
    return text.includes("&&") || text.includes("||") || /\b(and|or)\b/.test(text);
  }
  return language.decisionNodeTypes.includes(node.type) && node.type !== "binary_expression";
}

function walkNodes(
  root: SyntaxNode,
  language: LanguageDefinition,
  maxNodes: number,
  visit: (node: SyntaxNode, depth: number) => void,
): boolean {
  const stack: Array<{ node: SyntaxNode; depth: number }> = [{ node: root, depth: 0 }];
  let visited = 0;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    if (visited >= maxNodes) return true;
    visited += 1;
    const nextDepth = language.nestingNodeTypes.includes(entry.node.type) ? entry.depth + 1 : entry.depth;
    visit(entry.node, nextDepth);
    for (let index = entry.node.namedChildren.length - 1; index >= 0; index -= 1) {
      const child = entry.node.namedChildren[index];
      if (child !== undefined) stack.push({ node: child, depth: nextDepth });
    }
  }
  return false;
}

function complexityFor(node: SyntaxNode, language: LanguageDefinition, maxNodes: number): number {
  let score = 1;
  walkNodes(node, language, maxNodes, (child) => {
    if (isLogicalDecision(child, language)) score += 1;
  });
  return Math.min(score, 1_000);
}

export interface MetricsInput {
  source: string;
  language: LanguageDefinition;
  root: SyntaxNode;
  symbols: readonly SymbolDeclaration[];
  nodesById: Map<number, SyntaxNode>;
  importCount: number;
  maxNodes: number;
}

export function calculateMetrics(input: MetricsInput): CodeMetrics {
  const { source, language, root, symbols, nodesById, importCount, maxNodes } = input;
  const lines = splitLines(source);
  const commentLines = new Set<number>();
  let maxNestingDepth = 0;
  let traversalTruncated = false;
  traversalTruncated = walkNodes(root, language, maxNodes, (node, depth) => {
    if (language.commentNodeTypes.includes(node.type)) {
      for (let row = node.startPosition.row; row <= node.endPosition.row; row += 1) {
        commentLines.add(row + 1);
      }
    }
    if (depth > maxNestingDepth) maxNestingDepth = depth;
  });

  const blankLines = lines.filter((line) => line.trim() === "").length;
  const physicalSourceLines = Math.max(0, lines.length - blankLines - commentLines.size);
  const functionSymbols = symbols.filter(
    (symbol) => symbol.kind === "function" || symbol.kind === "method" || symbol.kind === "constructor",
  );
  const classCount = symbols.filter((symbol) =>
    ["class", "interface", "struct", "enum", "union", "trait"].includes(symbol.kind),
  ).length;

  const nodeByLocation = new Map<string, SyntaxNode>();
  for (const node of nodesById.values()) {
    nodeByLocation.set(`${node.startIndex}:${node.endIndex}`, node);
  }
  const functions: FunctionMetric[] = functionSymbols.map((symbol) => {
    const node = nodeByLocation.get(`${symbol.location.startIndex}:${symbol.location.endIndex}`);
    const linesSpanned = Math.max(1, symbol.location.endLine - symbol.location.startLine + 1);
    return {
      name: symbol.name,
      startLine: symbol.location.startLine,
      endLine: symbol.location.endLine,
      lines: linesSpanned,
      cyclomaticComplexity:
        language.capabilities.complexityEstimate && node !== undefined
          ? complexityFor(node, language, Math.min(maxNodes, 10_000))
          : null,
      complexityBasis: language.capabilities.complexityEstimate ? "estimated-decision-nodes" : "unsupported",
    };
  });
  const averageFunctionLength =
    functions.length === 0
      ? 0
      : Number((functions.reduce((sum, item) => sum + item.lines, 0) / functions.length).toFixed(2));
  const largestFunctions = [...functions].sort((left, right) => right.lines - left.lines).slice(0, 5);

  return {
    totalLines: lines.length,
    blankLines,
    commentLines: Math.min(commentLines.size, lines.length),
    physicalSourceLines,
    functionCount: functionSymbols.length,
    classCount,
    importCount,
    maxNestingDepth,
    averageFunctionLength,
    largestFunctions,
    complexitySupported: language.capabilities.complexityEstimate,
    calculationNotes: [
      "Lines are counted from top-level source line boundaries; blank lines contain only whitespace.",
      "Comment lines are derived from AST comment nodes; a line containing both code and a comment is counted as a comment line.",
      "Physical source lines = total lines - blank lines - comment lines.",
      "Nesting depth counts nested AST node types configured for the language, including declarations and control structures.",
      "Cyclomatic complexity is an estimate from decision nodes, not compiler-verified control-flow analysis.",
      ...(traversalTruncated ? [`AST traversal was truncated at ${maxNodes} nodes; metrics are partial.`] : []),
    ],
  };
}
