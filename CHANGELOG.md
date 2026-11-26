# Changelog

All notable changes to RepoLens are documented in this file.

## [0.3.0] - 2026-04-13

### Added
- A self-contained static source analysis engine in `src/analysis/` with strict TypeScript interfaces, language registry, parser cache, and deterministic extractors.
- Tree-sitter language support for JavaScript, JSX, TypeScript, TSX, Python, Java, Rust, C, and C++ (9 supported language IDs / 8 grammar families).
- Six new MCP tools: `get_file_symbols`, `get_file_outline`, `get_file_imports`, `get_file_exports`, `find_symbol`, and `get_code_metrics`.
- Repository source analysis service and symbol search service with bounded file counts, byte budgets, timeouts, and explicit partial-result reporting.
- `analyze_repository` options `include_source_analysis` and `max_analysis_files`; the tool now reports an optional `sourceAnalysis` section while preserving existing fields.
- Deterministic local fixtures and tests for declarations, nested symbols, imports/exports, overloads, comments/docstrings, malformed syntax, empty/Unicode files, and unsupported extensions.
- Analysis cache and resource-limit configuration via `REPOLENS_*` environment variables.

### Changed
- MCP server/package version bumped to `0.3.0`.
- README updated with architecture, tool reference, language capability matrix, configuration, security, and limitations for static analysis.
- Tool count increased from 15 to 21 while preserving the original 15 tools.

### Security / Safety
- Source analysis is read-only and AST-based; repository code is never executed.
- File content, symbol names, signatures, comments, and import paths remain untrusted repository data.
- Missing/unsupported grammars, parse timeouts, and oversized files return explicit partial/failure results instead of crashing the server.
