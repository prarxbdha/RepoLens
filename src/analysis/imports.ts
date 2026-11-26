import type { ImportDeclaration, LanguageDefinition, ModuleClassification } from "./types.js";
import type { QueryMatch, SyntaxNode } from "./utils.js";
import { childByField, childOfType, collapseWhitespace, toLocation } from "./utils.js";

const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "console", "constants", "crypto", "dgram", "dns", "events",
  "fs", "http", "https", "module", "net", "os", "path", "perf_hooks", "process", "querystring",
  "readline", "stream", "string_decoder", "timers", "tls", "url", "util", "vm", "zlib",
]);

const PYTHON_STDLIB = new Set([
  "abc", "argparse", "ast", "asyncio", "base64", "collections", "contextlib", "copy", "csv",
  "dataclasses", "datetime", "decimal", "enum", "functools", "hashlib", "importlib", "inspect",
  "itertools", "json", "logging", "math", "os", "pathlib", "random", "re", "shutil", "socket",
  "sqlite3", "statistics", "string", "subprocess", "sys", "tempfile", "threading", "time",
  "typing", "unittest", "urllib", "uuid", "warnings", "weakref", "xml", "zipfile",
]);

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'" || first === "<") && ((last === '"' || last === "'") || last === ">")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function classifyModule(module: string, language: LanguageDefinition): ModuleClassification {
  const normalized = module.toLowerCase();
  if (language.id === "javascript" || language.id === "jsx" || language.id === "typescript" || language.id === "tsx") {
    if (normalized.startsWith("node:")) return "standard-library";
    const bare = normalized.replace(/^node:/, "");
    if (NODE_BUILTINS.has(bare)) return "standard-library";
    return normalized.startsWith(".") || normalized.startsWith("/") ? "relative" : "external";
  }
  if (language.id === "python") {
    if (PYTHON_STDLIB.has(normalized.split(".")[0] ?? "")) return "standard-library";
    return normalized.startsWith(".") ? "relative" : "external";
  }
  if (language.id === "java") {
    if (normalized.startsWith("java.") || normalized.startsWith("javax.") || normalized.startsWith("jdk.")) {
      return "standard-library";
    }
    return "external";
  }
  if (language.id === "rust") {
    if (normalized.startsWith("std::") || normalized.startsWith("core::") || normalized.startsWith("alloc::")) {
      return "standard-library";
    }
    if (normalized.startsWith("crate::") || normalized.startsWith("self::") || normalized.startsWith("super::")) {
      return "relative";
    }
    return "external";
  }
  if (language.id === "c" || language.id === "cpp") return "unknown";
  return "unknown";
}

function jsImport(node: SyntaxNode, language: LanguageDefinition): ImportDeclaration {
  const source = childByField(node, ["source"]);
  const module = unquote(source?.text ?? "");
  const importedSymbols: string[] = [];
  let alias: string | null = null;
  const clause = childOfType(node, ["import_clause"]);
  for (const child of clause?.namedChildren ?? []) {
    if (child.type === "identifier") {
      importedSymbols.push("default");
      alias = child.text;
    } else if (child.type === "namespace_import") {
      importedSymbols.push("*");
      alias = child.namedChildren[0]?.text ?? null;
    } else if (child.type === "named_imports") {
      for (const specifier of child.namedChildren) {
        const name = childByField(specifier, ["name"])?.text ?? specifier.text;
        const specifierAlias = childByField(specifier, ["alias"])?.text ?? null;
        importedSymbols.push(specifierAlias === null ? name : `${name} as ${specifierAlias}`);
      }
    }
  }
  return {
    module,
    kind: "import",
    importedSymbols,
    alias,
    location: toLocation(node),
    classification: classifyModule(module, language),
    dynamic: false,
    resolved: false,
    note: "Syntax-derived module name only; no repository resolution was performed.",
  };
}

function requireImport(node: SyntaxNode, moduleNode: SyntaxNode, language: LanguageDefinition): ImportDeclaration {
  const module = unquote(moduleNode.text);
  const importCall = childOfType(node, ["call_expression"]);
  const declarator = importCall?.parent ?? null;
  const alias = declarator?.type === "variable_declarator" ? childByField(declarator, ["name"])?.text ?? null : null;
  const importedSymbols: string[] = [];
  const pattern = declarator === null ? null : childOfType(declarator, ["object_pattern"]);
  for (const property of pattern?.namedChildren ?? []) {
    const name = childByField(property, ["name"])?.text ?? property.namedChildren[0]?.text;
    if (name !== undefined && name !== "") importedSymbols.push(name);
  }
  return {
    module,
    kind: "require",
    importedSymbols,
    alias,
    location: toLocation(node),
    classification: classifyModule(module, language),
    dynamic: false,
    resolved: false,
    note: "Static require with a string literal only; dynamic require calls are not inferred.",
  };
}

function pythonImport(node: SyntaxNode, language: LanguageDefinition): ImportDeclaration {
  const isFrom = node.type === "import_from_statement";
  const moduleNode = isFrom ? childByField(node, ["module_name"]) : null;
  const module = unquote(moduleNode?.text ?? node.namedChildren.map((child) => child.text).join(", "));
  const importedSymbols: string[] = [];
  let alias: string | null = null;
  for (const child of node.namedChildren) {
    if (isFrom && childByField(node, ["module_name"])?.id === child.id) continue;
    if (child.type === "aliased_import") {
      const name = childByField(child, ["name"])?.text ?? "";
      const itemAlias = childByField(child, ["alias"])?.text ?? null;
      importedSymbols.push(itemAlias === null ? name : `${name} as ${itemAlias}`);
    } else if (child.type === "dotted_name" || child.type === "identifier") {
      importedSymbols.push(child.text);
    }
  }
  if (!isFrom && node.namedChildren.some((child) => child.type === "aliased_import")) {
    const firstAlias = node.namedChildren.find((child) => child.type === "aliased_import");
    alias = childByField(firstAlias ?? node, ["alias"])?.text ?? null;
  }
  return {
    module,
    kind: isFrom ? "from-import" : "import",
    importedSymbols: isFrom ? importedSymbols : [],
    alias,
    location: toLocation(node),
    classification: classifyModule(module, language),
    dynamic: false,
    resolved: false,
    note: "Syntax-derived module name only; Python import hooks and dynamic imports are not evaluated.",
  };
}

function javaImport(node: SyntaxNode, language: LanguageDefinition): ImportDeclaration {
  const module = node.namedChildren.map((child) => child.text).join("");
  const staticImport = node.namedChildren.some((child) => child.type === "static");
  const last = module.split(".").pop() ?? module;
  return {
    module: module.replace(/^static\s+/, ""),
    kind: "import",
    importedSymbols: last === "*" ? ["*"] : [last],
    alias: null,
    location: toLocation(node),
    classification: classifyModule(module, language),
    dynamic: false,
    resolved: false,
    note: staticImport
      ? "Static import; syntax-derived and not resolved to a repository file."
      : "Syntax-derived module name only; no repository resolution was performed.",
  };
}

function rustImport(node: SyntaxNode, language: LanguageDefinition): ImportDeclaration {
  const argument = childByField(node, ["argument"]);
  const raw = collapseWhitespace(argument?.text ?? "", 300);
  const module = raw.replace(/^(use|pub\s+use)\s+/, "");
  const importedSymbols: string[] = [];
  let alias: string | null = null;
  const asClause = argument?.type === "use_as_clause" ? argument : childOfType(argument ?? node, ["use_as_clause"]);
  if (asClause !== null) {
    const path = childByField(asClause, ["path"])?.text ?? "";
    const itemAlias = childByField(asClause, ["alias"])?.text ?? null;
    importedSymbols.push(itemAlias === null ? path : `${path} as ${itemAlias}`);
    alias = itemAlias;
  } else {
    importedSymbols.push(module);
  }
  return {
    module,
    kind: "use",
    importedSymbols,
    alias,
    location: toLocation(node),
    classification: classifyModule(module, language),
    dynamic: false,
    resolved: false,
    note: "Syntax-derived use path only; no crate resolution was performed.",
  };
}

function includeImport(node: SyntaxNode, language: LanguageDefinition): ImportDeclaration {
  const pathNode = childByField(node, ["path"]);
  const system = pathNode?.type === "system_lib_string";
  const module = unquote(pathNode?.text ?? "");
  return {
    module,
    kind: "include",
    importedSymbols: [],
    alias: null,
    location: toLocation(node),
    classification: system ? "standard-library" : module.startsWith(".") ? "relative" : "unknown",
    dynamic: false,
    resolved: false,
    note: "Include directive only; header search paths were not resolved.",
  };
}

export function extractImports(matches: readonly QueryMatch[], language: LanguageDefinition): ImportDeclaration[] {
  const imports: ImportDeclaration[] = [];
  for (const match of matches) {
    const importNode = match.captures.find((capture) => capture.name === "import")?.node;
    const requireNode = match.captures.find((capture) => capture.name === "require")?.node;
    const moduleNode = match.captures.find((capture) => capture.name === "module")?.node;
    const includeNode = match.captures.find((capture) => capture.name === "include")?.node;
    if (importNode !== undefined) {
      if (language.id === "python") imports.push(pythonImport(importNode, language));
      else if (language.id === "java") imports.push(javaImport(importNode, language));
      else if (language.id === "rust") imports.push(rustImport(importNode, language));
      else imports.push(jsImport(importNode, language));
    } else if (requireNode !== undefined && moduleNode !== undefined) {
      imports.push(requireImport(requireNode, moduleNode, language));
    } else if (includeNode !== undefined) {
      imports.push(includeImport(includeNode, language));
    }
  }
  return imports.sort((left, right) => left.location.startIndex - right.location.startIndex);
}
