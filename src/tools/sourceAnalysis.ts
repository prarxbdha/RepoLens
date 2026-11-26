/** Six MCP tools for Tree-sitter-backed source inspection. */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  LANGUAGE_IDS,
  SYMBOL_KINDS,
  type SymbolDeclaration,
} from "../analysis/types.js";
import type { GitHubClient } from "../github/client.js";
import { analyzeRepositoryFile } from "../services/sourceAnalysis.js";
import { findSymbolInRepository } from "../services/symbolSearch.js";
import {
  jsonResult,
  pathInput,
  refInput,
  repoInput,
  safeTool,
} from "./common.js";

const sourceFileInput = repoInput.extend({
  path: pathInput,
  ref: refInput,
});

const maxSymbolsInput = z.number().int().min(1).max(500).default(200);
const maxImportsInput = z.number().int().min(1).max(500).default(100);
const maxExportsInput = z.number().int().min(1).max(500).default(100);

const symbolKindInput = z.enum(SYMBOL_KINDS).optional();
const languageInput = z.enum(LANGUAGE_IDS).optional();

const EXPORT_CATEGORIES = [
  "explicit-module-export",
  "public-visibility",
  "inferred-api-candidate",
] as const;
const MODULE_CLASSIFICATIONS = [
  "relative",
  "external",
  "standard-library",
  "unknown",
] as const;

interface OutlineNode {
  id: string;
  name: string;
  kind: string;
  signature: string;
  visibility: string;
  exported: boolean;
  overload: boolean;
  startLine: number;
  endLine: number;
  children: OutlineNode[];
}

function buildOutline(symbols: readonly SymbolDeclaration[]): {
  roots: OutlineNode[];
  depth: number;
} {
  const nodes = symbols.map((symbol) => ({
    id: symbol.id,
    name: symbol.name,
    kind: symbol.kind,
    signature: symbol.signature,
    visibility: symbol.visibility,
    exported: symbol.exported,
    overload: symbol.overload,
    startLine: symbol.location.startLine,
    endLine: symbol.location.endLine,
    children: [] as OutlineNode[],
  }));
  const roots: OutlineNode[] = [];
  nodes.forEach((node, index) => {
    const symbol = symbols[index];
    if (symbol === undefined) return;
    let parentIndex = -1;
    let parentStart = -1;
    symbols.forEach((candidate, index) => {
      if (
        candidate !== symbol &&
        candidate.location.startIndex > parentStart &&
        candidate.location.startIndex < symbol.location.startIndex &&
        candidate.location.endIndex >= symbol.location.endIndex
      ) {
        parentIndex = index;
        parentStart = candidate.location.startIndex;
      }
    });
    if (parentIndex === -1) {
      roots.push(node);
      return;
    }
    const parent = nodes[parentIndex];
    if (parent !== undefined) parent.children.push(node);
    else roots.push(node);
  });

  const depthOf = (node: OutlineNode): number =>
    node.children.length === 0 ? 1 : 1 + Math.max(...node.children.map(depthOf));
  return { roots, depth: roots.length === 0 ? 0 : Math.max(...roots.map(depthOf)) };
}

async function loadSource(
  client: GitHubClient,
  owner: string,
  repo: string,
  path: string,
  ref: string | undefined,
) {
  return analyzeRepositoryFile(client, owner, repo, path, { ref });
}

export function registerSourceAnalysisTools(server: McpServer, client: GitHubClient): void {
  server.registerTool(
    "get_file_symbols",
    {
      title: "Get file symbols",
      description:
        "Parse one repository file with Tree-sitter and return declarations with locations, signatures, parameters, visibility, documentation, and syntax errors. No code is executed.",
      inputSchema: sourceFileInput.extend({
        kind: symbolKindInput,
        max_symbols: maxSymbolsInput,
      }),
    },
    async ({ owner, repo, path, ref, kind, max_symbols }) =>
      safeTool(async () => {
        const file = await loadSource(client, owner, repo, path, ref);
        const { analysis } = file;
        const selected = analysis.symbols.filter((symbol) => kind === undefined || symbol.kind === kind);
        const truncated = selected.length > max_symbols || analysis.symbols.length > max_symbols;
        return jsonResult({
          owner,
          repo,
          path: file.path,
          blobSha: file.sha,
          ref: ref ?? null,
          language: analysis.language,
          languageName: analysis.languageName,
          grammarVersion: analysis.grammarVersion,
          contentHash: analysis.contentHash,
          size: file.size,
          contentTruncated: file.contentTruncated,
          symbols: selected.slice(0, max_symbols),
          symbolCount: selected.length,
          totalSymbols: analysis.symbols.length,
          kindFilter: kind ?? null,
          truncated,
          syntaxErrors: analysis.syntaxErrors,
          incomplete: file.incomplete,
          errors: analysis.errors,
          warnings: analysis.warnings,
          untrustedData: true,
          note: analysis.note,
        });
      }),
  );

  server.registerTool(
    "get_file_outline",
    {
      title: "Get file outline",
      description:
        "Return a hierarchical outline of declarations parsed from one repository file, with bounded node counts and explicit syntax-error reporting.",
      inputSchema: sourceFileInput.extend({
        max_symbols: maxSymbolsInput,
      }),
    },
    async ({ owner, repo, path, ref, max_symbols }) =>
      safeTool(async () => {
        const file = await loadSource(client, owner, repo, path, ref);
        const { analysis } = file;
        const symbols = analysis.symbols.slice(0, max_symbols);
        const outline = buildOutline(symbols);
        return jsonResult({
          owner,
          repo,
          path: file.path,
          blobSha: file.sha,
          ref: ref ?? null,
          language: analysis.language,
          languageName: analysis.languageName,
          contentHash: analysis.contentHash,
          outline: outline.roots,
          rootCount: outline.roots.length,
          symbolCount: symbols.length,
          totalSymbols: analysis.symbols.length,
          maxDepth: outline.depth,
          truncated: analysis.symbols.length > max_symbols,
          syntaxErrors: analysis.syntaxErrors,
          incomplete: file.incomplete,
          errors: analysis.errors,
          warnings: analysis.warnings,
          untrustedData: true,
          note: analysis.note,
        });
      }),
  );

  server.registerTool(
    "get_file_imports",
    {
      title: "Get file imports",
      description:
        "List syntax-derived imports, requires, and include directives from one repository file. Module paths are not resolved to repository files.",
      inputSchema: sourceFileInput.extend({
        classification: z.enum(MODULE_CLASSIFICATIONS).optional(),
        max_imports: maxImportsInput,
      }),
    },
    async ({ owner, repo, path, ref, classification, max_imports }) =>
      safeTool(async () => {
        const file = await loadSource(client, owner, repo, path, ref);
        const { analysis } = file;
        const selected = analysis.imports.filter(
          (item) => classification === undefined || item.classification === classification,
        );
        const byClassification = selected.reduce<Record<string, number>>((counts, item) => {
          counts[item.classification] = (counts[item.classification] ?? 0) + 1;
          return counts;
        }, {});
        return jsonResult({
          owner,
          repo,
          path: file.path,
          blobSha: file.sha,
          language: analysis.language,
          imports: selected.slice(0, max_imports),
          importCount: selected.length,
          totalImports: analysis.imports.length,
          byClassification,
          classificationFilter: classification ?? null,
          truncated: selected.length > max_imports,
          incomplete: file.incomplete,
          errors: analysis.errors,
          warnings: analysis.warnings,
          untrustedData: true,
          note: "Import paths are untrusted syntax-derived strings; no modules were loaded or resolved.",
        });
      }),
  );

  server.registerTool(
    "get_file_exports",
    {
      title: "Get file exports",
      description:
        "List explicit module exports, public declarations, and labelled inferred API candidates from one repository file.",
      inputSchema: sourceFileInput.extend({
        category: z.enum(EXPORT_CATEGORIES).optional(),
        max_exports: maxExportsInput,
      }),
    },
    async ({ owner, repo, path, ref, category, max_exports }) =>
      safeTool(async () => {
        const file = await loadSource(client, owner, repo, path, ref);
        const { analysis } = file;
        const selected = analysis.exports.filter(
          (item) => category === undefined || item.category === category,
        );
        const byCategory = selected.reduce<Record<string, number>>((counts, item) => {
          counts[item.category] = (counts[item.category] ?? 0) + 1;
          return counts;
        }, {});
        return jsonResult({
          owner,
          repo,
          path: file.path,
          blobSha: file.sha,
          language: analysis.language,
          exports: selected.slice(0, max_exports),
          exportCount: selected.length,
          totalExports: analysis.exports.length,
          byCategory,
          categoryFilter: category ?? null,
          truncated: selected.length > max_exports,
          incomplete: file.incomplete,
          errors: analysis.errors,
          warnings: analysis.warnings,
          untrustedData: true,
          note: "Inferred API candidates are syntax-derived and are not proof of a public runtime API.",
        });
      }),
  );

  server.registerTool(
    "find_symbol",
    {
      title: "Find symbol",
      description:
        "Search declarations by name across a bounded set of supported repository files using local Tree-sitter parsing. This is not GitHub code search and needs no token.",
      inputSchema: repoInput.extend({
        name: z.string().trim().min(1).max(200),
        ref: refInput,
        path: pathInput.optional(),
        language: languageInput,
        kind: symbolKindInput,
        partial: z.boolean().default(false),
        case_sensitive: z.boolean().default(false),
        max_files: z.number().int().min(1).max(200).default(50),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    },
    async ({
      owner,
      repo,
      name,
      ref,
      path,
      language,
      kind,
      partial,
      case_sensitive,
      max_files,
      limit,
    }) =>
      safeTool(async () =>
        jsonResult(
          await findSymbolInRepository(client, owner, repo, name, {
            ref,
            path,
            language,
            kind,
            partial,
            caseSensitive: case_sensitive,
            maxFiles: max_files,
            limit,
          }),
        ),
      ),
  );

  server.registerTool(
    "get_code_metrics",
    {
      title: "Get code metrics",
      description:
        "Compute bounded line, comment, declaration, nesting, and estimated cyclomatic-complexity metrics for one repository file from its syntax tree.",
      inputSchema: sourceFileInput.extend({
        include_functions: z.boolean().default(true),
        max_functions: z.number().int().min(1).max(20).default(5),
      }),
    },
    async ({ owner, repo, path, ref, include_functions, max_functions }) =>
      safeTool(async () => {
        const file = await loadSource(client, owner, repo, path, ref);
        const { analysis } = file;
        return jsonResult({
          owner,
          repo,
          path: file.path,
          blobSha: file.sha,
          language: analysis.language,
          metrics: analysis.metrics,
          largestFunctions: include_functions
            ? analysis.metrics.largestFunctions.slice(0, max_functions)
            : [],
          syntaxErrorCount: analysis.syntaxErrors.length,
          incomplete: file.incomplete,
          errors: analysis.errors,
          warnings: analysis.warnings,
          untrustedData: true,
          note: analysis.note,
        });
      }),
  );
}
