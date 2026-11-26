/** Strict, GitHub- and MCP-independent types for static source analysis. */

export const LANGUAGE_IDS = [
  "javascript",
  "jsx",
  "typescript",
  "tsx",
  "python",
  "java",
  "rust",
  "c",
  "cpp",
] as const;

export type LanguageId = (typeof LANGUAGE_IDS)[number];

export const SYMBOL_KINDS = [
  "function",
  "method",
  "constructor",
  "class",
  "interface",
  "struct",
  "enum",
  "union",
  "trait",
  "type",
  "module",
  "namespace",
  "variable",
  "constant",
  "field",
  "macro",
] as const;

export type SymbolKind = (typeof SYMBOL_KINDS)[number];

export type Visibility = "public" | "protected" | "private" | "internal" | "unknown";
export type VisibilitySource = "syntax" | "convention" | "unknown";
export type InformationOrigin = "syntax" | "inferred";

export interface SourceLocation {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startIndex: number;
  endIndex: number;
}

export interface ParameterInfo {
  name: string;
  type: string | null;
  defaultValue: string | null;
  optional: boolean;
  variadic: boolean;
}

export interface DocumentationInfo {
  kind: "comment" | "docstring" | "none";
  summary: string;
  fullText: string;
}

export interface SyntaxErrorInfo {
  nodeType: string;
  message: string;
  location: SourceLocation;
}

export interface SymbolDeclaration {
  id: string;
  name: string;
  kind: SymbolKind;
  language: LanguageId;
  location: SourceLocation;
  signature: string;
  parentName: string | null;
  parentKind: SymbolKind | null;
  visibility: Visibility;
  visibilitySource: VisibilitySource;
  parameters: ParameterInfo[];
  returnType: string | null;
  documentation: DocumentationInfo | null;
  origin: InformationOrigin;
  exported: boolean;
  /** True when the declaration is a function-like overload signature. */
  overload: boolean;
}

export type ImportKind = "import" | "require" | "from-import" | "use" | "include" | "other";
export type ModuleClassification = "relative" | "external" | "standard-library" | "unknown";

export interface ImportDeclaration {
  module: string;
  kind: ImportKind;
  importedSymbols: string[];
  alias: string | null;
  location: SourceLocation;
  classification: ModuleClassification;
  dynamic: boolean;
  resolved: false;
  note: string;
}

export type ExportCategory =
  | "explicit-module-export"
  | "public-visibility"
  | "inferred-api-candidate";

export interface ExportDeclaration {
  name: string;
  kind: SymbolKind | "all" | "unknown";
  category: ExportCategory;
  language: LanguageId;
  location: SourceLocation;
  alias: string | null;
  signature: string | null;
  origin: InformationOrigin;
  linkage: string | null;
}

export interface FunctionMetric {
  name: string;
  startLine: number;
  endLine: number;
  lines: number;
  cyclomaticComplexity: number | null;
  complexityBasis: "estimated-decision-nodes" | "unsupported";
}

export interface CodeMetrics {
  totalLines: number;
  blankLines: number;
  commentLines: number;
  physicalSourceLines: number;
  functionCount: number;
  classCount: number;
  importCount: number;
  maxNestingDepth: number;
  averageFunctionLength: number;
  largestFunctions: FunctionMetric[];
  complexitySupported: boolean;
  calculationNotes: string[];
}

export interface AnalysisErrorInfo {
  kind: "unsupported-language" | "grammar-load" | "parse-timeout" | "parse-failure" | "limit" | "query";
  message: string;
}

export interface AnalysisLimits {
  maxSourceBytes: number;
  maxAstNodes: number;
  maxSymbols: number;
  parseTimeoutMs: number;
}

export interface AnalysisOptions extends Partial<AnalysisLimits> {
  blobSha?: string;
}

export interface AnalysisResult {
  path: string | null;
  language: LanguageId | null;
  languageName: string | null;
  grammarVersion: string | null;
  contentHash: string;
  supported: boolean;
  syntaxErrors: SyntaxErrorInfo[];
  symbols: SymbolDeclaration[];
  imports: ImportDeclaration[];
  exports: ExportDeclaration[];
  metrics: CodeMetrics;
  limits: AnalysisLimits;
  incomplete: boolean;
  errors: AnalysisErrorInfo[];
  warnings: string[];
  untrustedData: true;
  note: string;
}

export interface LanguageCapabilities {
  symbols: boolean;
  imports: boolean;
  exports: boolean;
  metrics: boolean;
  complexityEstimate: boolean;
}

export interface LanguageDefinition {
  id: LanguageId;
  name: string;
  extensions: readonly string[];
  grammarVersion: string;
  loadGrammar: () => Promise<unknown>;
  symbolQuery: string;
  importQuery?: string;
  exportQuery?: string;
  commentNodeTypes: readonly string[];
  nestingNodeTypes: readonly string[];
  decisionNodeTypes: readonly string[];
  capabilities: LanguageCapabilities;
}
