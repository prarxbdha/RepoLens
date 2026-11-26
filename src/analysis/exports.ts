import type {
  ExportDeclaration,
  LanguageDefinition,
  SymbolDeclaration,
  SymbolKind,
} from "./types.js";
import type { QueryMatch, SyntaxNode } from "./utils.js";
import { childByField, childOfType, collapseWhitespace, toLocation } from "./utils.js";

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && (trimmed.startsWith('"') || trimmed.startsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function addExport(
  result: ExportDeclaration[],
  seen: Set<string>,
  value: ExportDeclaration,
): void {
  const key = `${value.name}:${value.category}`;
  if (seen.has(key)) return;
  seen.add(key);
  result.push(value);
}

function symbolExport(
  symbol: SymbolDeclaration,
  category: ExportDeclaration["category"],
  origin: ExportDeclaration["origin"],
  linkage: string | null = null,
): ExportDeclaration {
  return {
    name: symbol.name,
    kind: symbol.kind,
    category,
    language: symbol.language,
    location: symbol.location,
    alias: null,
    signature: symbol.signature,
    origin,
    linkage,
  };
}

function jsExports(
  matches: readonly QueryMatch[],
  symbols: readonly SymbolDeclaration[],
  language: LanguageDefinition,
): ExportDeclaration[] {
  const result: ExportDeclaration[] = [];
  const seen = new Set<string>();
  const symbolByStart = new Map(symbols.map((symbol) => [symbol.location.startIndex, symbol]));

  for (const match of matches) {
    const statement = match.captures.find((capture) => capture.name === "export")?.node;
    const assignment = match.captures.find((capture) => capture.name === "assignment")?.node;
    if (statement !== undefined) {
      const declared = childByField(statement, ["declaration"]);
      const source = childByField(statement, ["source"]);
      const clause = childByField(statement, ["value"]) ?? childOfType(statement, ["export_clause"]);
      if (declared !== null) {
        const nested = symbols.filter(
          (symbol) =>
            symbol.parentName === null &&
            symbol.location.startIndex >= declared.startIndex &&
            symbol.location.endIndex <= declared.endIndex,
        );
        for (const symbol of nested) {
          addExport(result, seen, symbolExport(symbol, "explicit-module-export", "syntax"));
        }
        if (nested.length === 0) {
          addExport(result, seen, {
            name: declared.type === "class_declaration" ? "default class" : "default",
            kind: "unknown",
            category: "explicit-module-export",
            language: language.id,
            location: toLocation(statement),
            alias: null,
            signature: collapseWhitespace(declared.text, 200),
            origin: "syntax",
            linkage: null,
          });
        }
      } else if (clause !== null && clause.type === "export_clause") {
        for (const specifier of clause.namedChildren) {
          const name = childByField(specifier, ["name"])?.text ?? specifier.text;
          const alias = childByField(specifier, ["alias"])?.text ?? null;
          addExport(result, seen, {
            name,
            kind: "unknown",
            category: "explicit-module-export",
            language: language.id,
            location: toLocation(specifier),
            alias,
            signature: source === null ? null : `from ${source.text}`,
            origin: "syntax",
            linkage: null,
          });
        }
      } else {
        addExport(result, seen, {
          name: source === null ? "default" : "*",
          kind: source === null ? "unknown" : "all",
          category: "explicit-module-export",
          language: language.id,
          location: toLocation(statement),
          alias: null,
          signature: source === null ? null : `from ${source.text}`,
          origin: "syntax",
          linkage: null,
        });
      }
    } else if (assignment !== undefined) {
      const object = match.captures.find((capture) => capture.name === "object")?.node;
      const property = match.captures.find((capture) => capture.name === "property")?.node;
      if (object === undefined || property === undefined) continue;
      const isModuleExports = object.text === "module" && property.text === "exports";
      const isExports = object.text === "exports";
      if (!isModuleExports && !isExports) continue;
      const declared = symbolByStart.get(assignment.startIndex);
      addExport(result, seen, {
        name: isModuleExports ? "module.exports" : property.text,
        kind: declared?.kind ?? "unknown",
        category: "explicit-module-export",
        language: language.id,
        location: toLocation(assignment),
        alias: null,
        signature: collapseWhitespace(assignment.text, 200),
        origin: "syntax",
        linkage: null,
      });
    }
  }
  return result;
}

function pythonExports(
  matches: readonly QueryMatch[],
  symbols: readonly SymbolDeclaration[],
  language: LanguageDefinition,
): ExportDeclaration[] {
  const result: ExportDeclaration[] = [];
  const seen = new Set<string>();
  const exportedNames = new Set<string>();
  for (const match of matches) {
    const nameNode = match.captures.find((capture) => capture.name === "name")?.node;
    const assignment = match.captures.find((capture) => capture.name === "export")?.node;
    if (nameNode === undefined || nameNode.text !== "__all__" || assignment === undefined) continue;
    const list = childByField(assignment, ["right"]) ?? childOfType(assignment, ["list"]);
    for (const child of list?.namedChildren ?? []) {
      const stringNode = child.type === "string" ? child : childOfType(child, ["string"]);
      if (stringNode === null) continue;
      const content = childOfType(stringNode, ["string_content"])?.text ?? stripQuotes(stringNode.text);
      if (content === "") continue;
      exportedNames.add(content);
      addExport(result, seen, {
        name: content,
        kind: "unknown",
        category: "explicit-module-export",
        language: language.id,
        location: toLocation(child),
        alias: null,
        signature: null,
        origin: "syntax",
        linkage: null,
      });
    }
  }
  for (const symbol of symbols) {
    if (symbol.parentName !== null || symbol.name.startsWith("_") || exportedNames.has(symbol.name)) continue;
    addExport(result, seen, {
      ...symbolExport(symbol, "inferred-api-candidate", "inferred"),
      signature: null,
    });
  }
  return result;
}

function visibilityExports(
  matches: readonly QueryMatch[],
  symbols: readonly SymbolDeclaration[],
  language: LanguageDefinition,
): ExportDeclaration[] {
  const result: ExportDeclaration[] = [];
  const seen = new Set<string>();
  const declared = new Set(
    matches
      .map((match) => match.captures.find((capture) => capture.name === "declaration")?.node.startIndex)
      .filter((value): value is number => value !== undefined),
  );
  for (const symbol of symbols) {
    if (symbol.visibility !== "public" && symbol.visibility !== "protected") continue;
    if (declared.size > 0 && !declared.has(symbol.location.startIndex)) continue;
    addExport(result, seen, symbolExport(symbol, "public-visibility", "syntax"));
  }
  return result;
}

function linkageExports(
  symbols: readonly SymbolDeclaration[],
  language: LanguageDefinition,
): ExportDeclaration[] {
  const result: ExportDeclaration[] = [];
  const seen = new Set<string>();
  const kinds: SymbolKind[] = [
    "function",
    "method",
    "constructor",
    "class",
    "struct",
    "enum",
    "union",
    "type",
    "variable",
    "constant",
    "namespace",
  ];
  for (const symbol of symbols) {
    if (!kinds.includes(symbol.kind)) continue;
    if (symbol.visibility === "internal") continue;
    if (symbol.parentName !== null && symbol.parentKind !== "namespace" && symbol.kind !== "method") {
      continue;
    }
    if (symbol.kind === "method" && !["public", "protected"].includes(symbol.visibility)) {
      continue;
    }
    addExport(result, seen, {
      ...symbolExport(symbol, "inferred-api-candidate", "inferred", "external linkage"),
      signature: null,
    });
  }
  return result;
}

export interface ExportExtraction {
  exports: ExportDeclaration[];
  exportedNames: Set<string>;
}

export function extractExports(
  matches: readonly QueryMatch[],
  symbols: readonly SymbolDeclaration[],
  language: LanguageDefinition,
): ExportExtraction {
  let exports: ExportDeclaration[];
  if (language.id === "javascript" || language.id === "jsx" || language.id === "typescript" || language.id === "tsx") {
    exports = jsExports(matches, symbols, language);
  } else if (language.id === "python") {
    exports = pythonExports(matches, symbols, language);
  } else if (language.id === "java" || language.id === "rust") {
    exports = visibilityExports(matches, symbols, language);
  } else {
    exports = linkageExports(symbols, language);
  }
  return {
    exports,
    exportedNames: new Set(exports.filter((item) => item.category !== "inferred-api-candidate").map((item) => item.name)),
  };
}
