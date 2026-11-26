/** Normalizes Tree-sitter matches into strict, language-independent declarations. */

import type {
  LanguageDefinition,
  SymbolDeclaration,
  SymbolKind,
  Visibility,
  VisibilitySource,
} from "./types.js";
import type { QueryMatch, SyntaxNode } from "./utils.js";
import {
  childByField,
  childOfType,
  cleanIdentifier,
  collapseWhitespace,
  firstSummary,
  stableSymbolId,
  stripCommentMarkers,
  toLocation,
} from "./utils.js";

const BODY_TYPES = [
  "statement_block",
  "block",
  "class_body",
  "interface_body",
  "enum_body",
  "enum_variant_list",
  "field_declaration_list",
  "declaration_list",
  "constructor_body",
  "compound_statement",
];

const PARAMETER_TYPES = [
  "identifier",
  "property_identifier",
  "required_parameter",
  "optional_parameter",
  "assignment_pattern",
  "rest_parameter",
  "typed_parameter",
  "typed_default_parameter",
  "default_parameter",
  "parameter",
  "formal_parameter",
  "parameter_declaration",
  "self_parameter",
  "shorthand_property_identifier_pattern",
  "object_pattern",
];

const CONTAINER_TYPES = [
  "class_declaration",
  "abstract_class_declaration",
  "class",
  "class_specifier",
  "class_definition",
  "struct_item",
  "struct_specifier",
  "interface_declaration",
  "trait_item",
  "enum_item",
  "enum_specifier",
  "impl_item",
  "namespace_definition",
  "mod_item",
];

const DOC_WRAPPERS = [
  "export_statement",
  "lexical_declaration",
  "variable_declaration",
  "field_declaration",
  "public_field_definition",
  "template_declaration",
  "template_function",
];

function normalizeTypeName(value: string): string {
  return cleanIdentifier(value)
    .replace(/<[^>]*>/g, "")
    .replace(/^.*::/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferKind(node: SyntaxNode, language: LanguageDefinition, name: string): SymbolKind | null {
  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration":
    case "function_expression":
    case "function_definition":
    case "function_item":
    case "function_signature_item":
      return "function";
    case "method_definition":
    case "method_signature":
    case "abstract_method_signature":
    case "method_declaration":
      return "method";
    case "constructor_declaration":
      return "constructor";
    case "class_declaration":
    case "abstract_class_declaration":
    case "class":
    case "class_specifier":
    case "class_definition":
      return "class";
    case "interface_declaration":
      return "interface";
    case "struct_item":
    case "struct_specifier":
      return "struct";
    case "enum_declaration":
    case "enum_specifier":
    case "enum_item":
      return "enum";
    case "union_item":
    case "union_specifier":
      return "union";
    case "trait_item":
      return "trait";
    case "type_alias_declaration":
    case "type_item":
    case "type_definition":
      return "type";
    case "mod_item":
    case "namespace_definition":
      return "namespace";
    case "macro_definition":
      return "macro";
    case "const_item":
    case "static_item":
    case "const_declaration":
      return "constant";
    case "variable_declarator":
    case "init_declarator":
    case "declaration":
    case "lexical_declaration":
    case "variable_declaration":
    case "assignment": {
      const value = childByField(node, ["value"]);
      if (value !== null && (value.type === "arrow_function" || value.type === "function_expression")) {
        return "function";
      }
      if (
        language.id === "python" &&
        /^[A-Z][A-Z0-9_]*$/.test(name)
      ) {
        return "constant";
      }
      if (node.type === "lexical_declaration" || node.firstNamedChild?.text.includes("const")) {
        return "constant";
      }
      return "variable";
    }
    case "field_declaration":
    case "public_field_definition":
    case "property_signature":
      return "field";
    default:
      return null;
  }
}

function containerFor(node: SyntaxNode): { name: string; kind: SymbolKind } | null {
  let current = node.parent;
  while (current !== null) {
    if (CONTAINER_TYPES.includes(current.type)) {
      const typeNode = childByField(current, ["type", "name"]);
      const name =
        current.type === "impl_item" && typeNode !== null
          ? normalizeTypeName(typeNode.text)
          : normalizeTypeName(childByField(current, ["name"])?.text ?? typeNode?.text ?? "");
      if (name !== "") {
        const kind: SymbolKind =
          current.type === "interface_declaration"
            ? "interface"
            : current.type === "trait_item"
              ? "trait"
              : current.type === "namespace_definition" || current.type === "mod_item"
                ? "namespace"
                : current.type.includes("enum")
                  ? "enum"
                  : current.type.includes("struct")
                    ? "struct"
                    : "class";
        return { name, kind };
      }
    }
    current = current.parent;
  }
  return null;
}

function signatureFor(node: SyntaxNode, kind: SymbolKind, source: string): string {
  if (kind === "variable" || kind === "constant" || kind === "field") {
    return collapseWhitespace(source.slice(node.startIndex, node.endIndex));
  }
  const body = childByField(node, ["body"]) ?? childOfType(node, BODY_TYPES);
  const end = body === null ? node.endIndex : Math.min(body.startIndex, node.endIndex);
  const prefix = collapseWhitespace(source.slice(node.startIndex, end));
  return prefix === "" ? `${kind} declaration` : prefix;
}

function nameFromParameter(node: SyntaxNode): string | null {
  const named = childByField(node, ["name", "pattern"]);
  if (named !== null) {
    if (named.type === "object_pattern") {
      const names = named.namedChildren
        .map((child) => cleanIdentifier(child.text))
        .filter((value) => value !== "");
      if (names.length > 0) return names.join(", ");
    }
    const inner = named.type === "assignment_pattern" ? childByField(named, ["left"]) : named;
    if (inner !== null && inner.text.trim() !== "") return cleanIdentifier(inner.text);
  }
  if (PARAMETER_TYPES.includes(node.type)) {
    const identifier = childOfType(node, ["identifier", "property_identifier", "field_identifier"]);
    if (identifier !== null) return cleanIdentifier(identifier.text);
  }
  if (/^[A-Za-z_$][\w$]*$/.test(node.text.trim())) return cleanIdentifier(node.text);
  return null;
}

function parametersFor(node: SyntaxNode) {
  const parameters =
    childByField(node, ["parameters"]) ??
    childOfType(node, ["formal_parameters", "parameters", "parameter_list"]);
  if (parameters === null) return [];
  const result = [];
  for (const child of parameters.namedChildren) {
    if (!PARAMETER_TYPES.includes(child.type)) continue;
    const name = nameFromParameter(child);
    if (name === null || name === "self" || name === "this" || name === "...") continue;
    const typeNode = childByField(child, ["type"]);
    const valueNode = childByField(child, ["value", "defaultValue"]);
    result.push({
      name,
      type: typeNode === null ? null : collapseWhitespace(typeNode.text, 120),
      defaultValue: valueNode === null ? null : collapseWhitespace(valueNode.text, 120),
      optional:
        child.type === "optional_parameter" ||
        child.type === "typed_default_parameter" ||
        child.type === "default_parameter" ||
        child.namedChildren.some((item) => item.type === "?"),
      variadic: child.type === "rest_parameter" || child.text.trimStart().startsWith("..."),
    });
  }
  return result;
}

function returnTypeFor(node: SyntaxNode, kind: SymbolKind): string | null {
  if (
    kind === "class" ||
    kind === "interface" ||
    kind === "struct" ||
    kind === "enum" ||
    kind === "field" ||
    kind === "constructor"
  ) {
    return null;
  }
  const typeNode = childByField(node, ["return_type", "type"]);
  if (typeNode === null) return null;
  const text = collapseWhitespace(typeNode.text, 200);
  return text === "" ? null : text;
}

function visibilityFor(
  node: SyntaxNode,
  name: string,
  language: LanguageDefinition,
): { visibility: Visibility; source: VisibilitySource } {
  if (language.id === "rust") {
    const modifier = childOfType(node, ["visibility_modifier"]);
    if (modifier !== null) {
      return {
        visibility:
          modifier.text.includes("crate") || modifier.text.includes("super") ? "internal" : "public",
        source: "syntax",
      };
    }
    return { visibility: "unknown", source: "unknown" };
  }
  if (language.id === "java") {
    const modifiers = childOfType(node, ["modifiers"]);
    const text = modifiers?.text ?? "";
    if (/\bpublic\b/.test(text)) return { visibility: "public", source: "syntax" };
    if (/\bprotected\b/.test(text)) return { visibility: "protected", source: "syntax" };
    if (/\bprivate\b/.test(text)) return { visibility: "private", source: "syntax" };
    return { visibility: "unknown", source: "unknown" };
  }
  if (language.id === "typescript" || language.id === "tsx") {
    const modifier = childOfType(node, ["accessibility_modifier"]);
    const text = modifier?.text ?? "";
    if (text === "public" || text === "protected" || text === "private") {
      return { visibility: text, source: "syntax" };
    }
  }
  if (language.id === "c" || language.id === "cpp") {
    const storage = childOfType(node, ["storage_class_specifier"]);
    if (storage?.text === "static") return { visibility: "internal", source: "syntax" };
    const siblings = node.parent?.namedChildren ?? [];
    for (const sibling of siblings) {
      if (sibling.id === node.id) break;
      if (sibling.type === "access_specifier") {
        if (sibling.text.startsWith("public")) return { visibility: "public", source: "syntax" };
        if (sibling.text.startsWith("protected")) return { visibility: "protected", source: "syntax" };
        if (sibling.text.startsWith("private")) return { visibility: "private", source: "syntax" };
      }
    }
    if (node.parent?.type === "class_specifier") return { visibility: "private", source: "syntax" };
  }
  if (language.id === "python" && name.startsWith("_")) {
    return { visibility: "private", source: "convention" };
  }
  if (name.startsWith("#")) return { visibility: "private", source: "syntax" };
  return { visibility: "unknown", source: "unknown" };
}

function documentationFor(node: SyntaxNode, language: LanguageDefinition) {
  const commentTypes = language.commentNodeTypes;
  const candidates: SyntaxNode[] = [node];
  if (node.parent !== null && DOC_WRAPPERS.includes(node.parent.type)) candidates.push(node.parent);
  for (const candidate of candidates) {
    const comments: string[] = [];
    let previous = candidate.previousNamedSibling;
    while (previous !== null && commentTypes.includes(previous.type)) {
      comments.unshift(previous.text);
      previous = previous.previousNamedSibling;
    }
    if (comments.length > 0) {
      const fullText = stripCommentMarkers(comments.join("\n"));
      if (fullText !== "") {
        return {
          kind: "comment" as const,
          summary: firstSummary(fullText),
          fullText,
        };
      }
    }
  }
  if (language.id === "python") {
    const body = childByField(node, ["body"]);
    const statement = body?.namedChildren[0];
    if (statement?.type === "expression_statement") {
      const stringNode = statement.namedChildren.find((child) => child.type === "string");
      if (stringNode !== undefined) {
        const content = childOfType(stringNode, ["string_content"])?.text ?? stringNode.text;
        const fullText = content.trim();
        if (fullText !== "") {
          return { kind: "docstring" as const, summary: firstSummary(fullText), fullText };
        }
      }
    }
  }
  return null;
}

export interface SymbolExtraction {
  symbols: SymbolDeclaration[];
  nodesById: Map<number, SyntaxNode>;
  truncated: boolean;
}

export function extractSymbols(
  matches: readonly QueryMatch[],
  source: string,
  language: LanguageDefinition,
  maxSymbols: number,
): SymbolExtraction {
  const byKey = new Map<string, SymbolDeclaration>();
  const nodesById = new Map<number, SyntaxNode>();
  const kindPriority: Record<SymbolKind, number> = {
    function: 10,
    method: 10,
    constructor: 10,
    class: 9,
    interface: 9,
    struct: 9,
    enum: 9,
    union: 9,
    trait: 9,
    type: 8,
    namespace: 7,
    module: 7,
    macro: 7,
    constant: 4,
    variable: 4,
    field: 3,
  };

  for (const match of matches) {
    const declaration = match.captures.find((capture) => capture.name === "declaration")?.node;
    const nameNode = match.captures.find((capture) => capture.name === "name")?.node;
    if (declaration === undefined || nameNode === undefined) continue;
    if (declaration.type === "function_declarator" && declaration.parent?.type === "function_definition") {
      continue;
    }
    const name = cleanIdentifier(nameNode.text);
    if (name === "") continue;
    let kind = inferKind(declaration, language, name);
    if (kind === null) continue;
    let parentName: string | null = null;
    let parentKind: SymbolKind | null = null;
    const container = containerFor(declaration);
    if (
      container !== null &&
      (kind === "function" || kind === "method" || kind === "constructor")
    ) {
      const methodContainers = new Set<SymbolKind>(["class", "struct", "interface", "trait", "enum"]);
      if (methodContainers.has(container.kind) && kind !== "constructor") kind = "method";
      parentName = container.name;
      parentKind = container.kind;
    }
    if (language.id === "javascript" || language.id === "jsx" || language.id === "typescript" || language.id === "tsx") {
      if (kind === "method" && name === "constructor") kind = "constructor";
    }
    if ((language.id === "c" || language.id === "cpp") && kind === "method" && parentName === name) {
      kind = "constructor";
    }
    const location = toLocation(declaration);
    const key = `${name}:${location.startIndex}:${location.endIndex}`;
    const existing = byKey.get(key);
    if (existing !== undefined && kindPriority[existing.kind] >= kindPriority[kind]) continue;
    const visibility = visibilityFor(declaration, name, language);
    const symbol: SymbolDeclaration = {
      id: stableSymbolId(kind, name, location),
      name,
      kind,
      language: language.id,
      location,
      signature: signatureFor(declaration, kind, source),
      parentName,
      parentKind,
      visibility: visibility.visibility,
      visibilitySource: visibility.source,
      parameters: parametersFor(declaration),
      returnType: returnTypeFor(declaration, kind),
      documentation: documentationFor(declaration, language),
      origin: "syntax",
      exported: false,
      overload:
        declaration.type === "method_signature" ||
        declaration.type === "function_signature" ||
        declaration.type === "function_signature_item" ||
        declaration.type === "abstract_method_signature",
    };
    byKey.set(key, symbol);
    nodesById.set(declaration.id, declaration);
  }

  const allSymbols = [...byKey.values()].sort(
    (left, right) => left.location.startIndex - right.location.startIndex,
  );
  const filtered = allSymbols.filter((symbol) => {
    if ((language.id === "c" || language.id === "cpp") && symbol.kind === "type") {
      return !allSymbols.some(
        (other) =>
          (other.kind === "struct" || other.kind === "enum") && other.name === symbol.name,
      );
    }
    return true;
  });
  const seenAggregates = new Set<string>();
  const symbols = filtered.filter((symbol) => {
    if (
      (language.id === "c" || language.id === "cpp") &&
      ["struct", "enum", "union"].includes(symbol.kind)
    ) {
      const key = `${symbol.kind}:${symbol.name}`;
      if (seenAggregates.has(key)) return false;
      seenAggregates.add(key);
    }
    return true;
  });
  linkParents(symbols, nodesById);
  return {
    symbols: symbols.slice(0, maxSymbols),
    nodesById,
    truncated: symbols.length > maxSymbols,
  };
}

function linkParents(symbols: readonly SymbolDeclaration[], nodesById: Map<number, SyntaxNode>): void {
  const nodeByLocation = new Map<string, SyntaxNode>();
  for (const node of nodesById.values()) {
    nodeByLocation.set(`${node.startIndex}:${node.endIndex}`, node);
  }
  const symbolByLocation = new Map<string, SymbolDeclaration>();
  for (const symbol of symbols) {
    symbolByLocation.set(`${symbol.location.startIndex}:${symbol.location.endIndex}`, symbol);
  }
  for (const symbol of symbols) {
    let current =
      nodeByLocation.get(`${symbol.location.startIndex}:${symbol.location.endIndex}`)?.parent ?? null;
    while (current !== null) {
      if (nodesById.has(current.id)) {
        const parent = symbolByLocation.get(`${current.startIndex}:${current.endIndex}`);
        if (parent !== undefined && parent !== symbol) {
          symbol.parentName = parent.name;
          symbol.parentKind = parent.kind;
        }
        break;
      }
      current = current.parent;
    }
  }
}
