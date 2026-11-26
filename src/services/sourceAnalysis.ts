/** Bounded GitHub file retrieval plus local, read-only Tree-sitter analysis. */

import { detectLanguage } from "../analysis/languageRegistry.js";
import { analyzeSource } from "../analysis/parser.js";
import type {
  AnalysisErrorInfo,
  AnalysisOptions,
  AnalysisResult,
} from "../analysis/types.js";
import { loadConfig, type RepoLensConfig } from "../config/env.js";
import { GitHubClient, describeError } from "../github/client.js";
import { resolveRef, type TreeEntryView } from "./repository.js";

const IGNORED_PATH_PREFIXES = [
  "node_modules/",
  "vendor/",
  "dist/",
  "build/",
  "target/",
  "coverage/",
  ".git/",
];

export interface RepositoryFileAnalysisOptions extends AnalysisOptions {
  ref?: string;
  maxBytes?: number;
}

export interface AnalyzedFile {
  path: string;
  sha: string;
  size: number;
  binary: boolean;
  contentTruncated: boolean;
  analysis: AnalysisResult;
  incomplete: boolean;
}

function cloneResult(result: AnalysisResult): AnalysisResult {
  return JSON.parse(JSON.stringify(result)) as AnalysisResult;
}

/** Analyzes one repository file without executing its contents. */
export async function analyzeRepositoryFile(
  client: GitHubClient,
  owner: string,
  repo: string,
  path: string,
  options: RepositoryFileAnalysisOptions = {},
  config: RepoLensConfig = loadConfig(),
): Promise<AnalyzedFile> {
  const { ref, maxBytes, ...analysisOptions } = options;
  const effectiveMaxBytes = Math.min(
    maxBytes ?? config.maxAnalysisSourceBytes,
    config.maxFileBytes,
    config.maxAnalysisSourceBytes,
  );
  const file = await client.getFile(owner, repo, path, { ref, maxBytes: effectiveMaxBytes });
  const language = detectLanguage(file.path);
  const analysis = cloneResult(
    await analyzeSource(
      file.content,
      {
        ...analysisOptions,
        languageId: language?.id ?? file.path.split(".").pop() ?? "",
        blobSha: file.sha,
        maxSourceBytes: effectiveMaxBytes,
      },
      config,
    ),
  );
  analysis.path = file.path;

  if (file.binary) {
    analysis.supported = false;
    analysis.errors.push({
      kind: "limit",
      message: "File was detected as binary; source analysis was skipped.",
    });
  }
  if (file.truncated) {
    analysis.errors.push({
      kind: "limit",
      message: `GitHub file content was truncated at ${effectiveMaxBytes} bytes; results are partial.`,
    });
  }
  analysis.incomplete = analysis.incomplete || analysis.errors.length > 0;

  return {
    path: file.path,
    sha: file.sha,
    size: file.size,
    binary: file.binary,
    contentTruncated: file.truncated,
    analysis,
    incomplete: analysis.incomplete,
  };
}

export interface SourceFileSummary {
  path: string;
  language: string | null;
  contentHash: string;
  blobSha: string;
  symbolCount: number;
  functionCount: number;
  classCount: number;
  importCount: number;
  exportCount: number;
  syntaxErrorCount: number;
  incomplete: boolean;
  errors: string[];
}

export interface SourceAggregate {
  filesAnalyzed: number;
  symbols: number;
  functions: number;
  classes: number;
  imports: number;
  exports: number;
  syntaxErrors: number;
}

export interface RepositorySourceAnalysis {
  requested: boolean;
  candidateCount: number;
  filesAnalyzed: number;
  filesSkipped: number;
  filesFailed: number;
  files: SourceFileSummary[];
  aggregate: SourceAggregate;
  errors: string[];
  warnings: string[];
  truncated: boolean;
  incomplete: boolean;
  note: string;
}

export function emptySourceAnalysis(): RepositorySourceAnalysis {
  return {
    requested: false,
    candidateCount: 0,
    filesAnalyzed: 0,
    filesSkipped: 0,
    filesFailed: 0,
    files: [],
    aggregate: {
      filesAnalyzed: 0,
      symbols: 0,
      functions: 0,
      classes: 0,
      imports: 0,
      exports: 0,
      syntaxErrors: 0,
    },
    errors: [],
    warnings: [],
    truncated: false,
    incomplete: false,
    note:
      "Source analysis was not requested; no repository code was fetched or parsed beyond the listed files.",
  };
}

export interface RepositorySourceAnalysisOptions {
  ref?: string;
  maxFiles?: number;
  maxBytes?: number;
  timeoutMs?: number;
}

function summarize(file: AnalyzedFile): SourceFileSummary {
  const { analysis } = file;
  return {
    path: file.path,
    language: analysis.language,
    contentHash: analysis.contentHash,
    blobSha: file.sha,
    symbolCount: analysis.symbols.length,
    functionCount: analysis.symbols.filter((symbol) =>
      ["function", "method", "constructor"].includes(symbol.kind),
    ).length,
    classCount: analysis.symbols.filter((symbol) =>
      ["class", "interface", "struct", "enum", "union", "trait"].includes(symbol.kind),
    ).length,
    importCount: analysis.imports.length,
    exportCount: analysis.exports.length,
    syntaxErrorCount: analysis.syntaxErrors.length,
    incomplete: file.incomplete,
    errors: analysis.errors.map((error) => error.message).slice(0, 10),
  };
}

function appendErrors(target: string[], path: string, errors: readonly AnalysisErrorInfo[]): void {
  for (const error of errors) {
    if (target.length >= 40) return;
    target.push(`${path}: ${error.message}`);
  }
}

/** Analyzes a bounded selection of supported files from a recursive repository tree. */
export async function analyzeRepositorySources(
  client: GitHubClient,
  owner: string,
  repo: string,
  entries: readonly TreeEntryView[],
  options: RepositorySourceAnalysisOptions = {},
  config: RepoLensConfig = loadConfig(),
): Promise<RepositorySourceAnalysis> {
  const maxFiles = Math.min(
    options.maxFiles ?? config.maxAnalysisFiles,
    config.maxAnalysisFiles,
  );
  const maxBytes = Math.min(
    options.maxBytes ?? config.maxSymbolSearchBytes,
    config.maxSymbolSearchBytes,
  );
  const timeoutMs = Math.min(options.timeoutMs ?? config.symbolSearchTimeoutMs, config.symbolSearchTimeoutMs);
  const deadline = Date.now() + timeoutMs;
  const ref = await resolveRef(client, owner, repo, options.ref);
  const candidates = entries
    .filter(
      (entry) =>
        entry.type === "blob" &&
        detectLanguage(entry.path) !== null &&
        !IGNORED_PATH_PREFIXES.some((prefix) => entry.path.startsWith(prefix)),
    )
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const selected = candidates.slice(0, Math.max(1, maxFiles));

  const result: RepositorySourceAnalysis = {
    requested: true,
    candidateCount: candidates.length,
    filesAnalyzed: 0,
    filesSkipped: 0,
    filesFailed: 0,
    files: [],
    aggregate: {
      filesAnalyzed: 0,
      symbols: 0,
      functions: 0,
      classes: 0,
      imports: 0,
      exports: 0,
      syntaxErrors: 0,
    },
    errors: [],
    warnings: [],
    truncated: candidates.length > selected.length,
    incomplete: false,
    note:
      "Supported source files were fetched through the read-only contents API and parsed locally with Tree-sitter; no repository code was executed.",
  };
  if (result.truncated) {
    result.warnings.push(
      `Only ${selected.length} of ${candidates.length} supported files were analyzed; repository source analysis is truncated.`,
    );
  }

  let bytesUsed = 0;
  for (const entry of selected) {
    if (Date.now() >= deadline) {
      result.truncated = true;
      result.incomplete = true;
      result.warnings.push(`Source analysis stopped after ${timeoutMs}ms; remaining files were skipped.`);
      break;
    }
    if (bytesUsed + (entry.size ?? 0) > maxBytes) {
      result.filesSkipped += 1;
      result.truncated = true;
      result.warnings.push(
        `Source analysis byte budget of ${maxBytes} bytes was reached; remaining files were skipped.`,
      );
      break;
    }
    try {
      const analyzed = await analyzeRepositoryFile(
        client,
        owner,
        repo,
        entry.path,
        { ref, maxBytes: config.maxAnalysisSourceBytes },
        config,
      );
      bytesUsed += analyzed.size;
      const summary = summarize(analyzed);
      result.files.push(summary);
      result.filesAnalyzed += 1;
      result.aggregate.filesAnalyzed += 1;
      result.aggregate.symbols += summary.symbolCount;
      result.aggregate.functions += summary.functionCount;
      result.aggregate.classes += summary.classCount;
      result.aggregate.imports += summary.importCount;
      result.aggregate.exports += summary.exportCount;
      result.aggregate.syntaxErrors += summary.syntaxErrorCount;
      if (analyzed.incomplete || !analyzed.analysis.supported) result.incomplete = true;
      appendErrors(result.errors, entry.path, analyzed.analysis.errors);
    } catch (error) {
      result.filesFailed += 1;
      result.incomplete = true;
      if (result.errors.length < 40) {
        result.errors.push(`${entry.path}: ${describeError(error)}`);
      }
    }
  }

  return result;
}
