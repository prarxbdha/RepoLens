# RepoLens

Read-only GitHub MCP server for OpenCode. RepoLens lets AI clients inspect remote repositories over stdio without cloning them, and can run bounded local Tree-sitter analysis on supported source files. Repository code is never executed.

## What it does

- **Repository exploration**: metadata, commits, issues, PRs, languages, README, tree, file content, code search.
- **Repository intelligence**: dependencies, contributors, commit/PR details, composite `analyze_repository` report.
- **Static source analysis**: symbols, outline, imports, exports, code metrics, and bounded symbol search for supported languages.
- **Safe by default**: read-only GitHub API, strict validation, bounded caches/timeouts, explicit truncation/errors, untrusted-data labeling.

## Quick start

```bash
git clone <repository-url>
cd RepoLens
npm install
npm run build
```

Run checks:

```bash
npm run typecheck
npm test
npm start
```

Requires Node.js 20+ (verified on Node 26).

## OpenCode setup

`opencode.json` is preconfigured for local stdio:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "repolens": {
        "type": "local",
        "command": ["node", "dist/index.js"],
        "cwd": ".",
        "environment": {
          "GITHUB_TOKEN": "{env:GITHUB_TOKEN}"
        }
      }
    }
  }
}
```

Verify:

```bash
npm run build
opencode mcp list
```

Use `/reload` in OpenCode after config changes.

## GitHub authentication

- **Optional** for most public-repo tools.
- **Required** for `search_code`.
- Set `GITHUB_TOKEN` with public-repo read access for better rate limits.

```bash
export GITHUB_TOKEN="..."
```

Tokens are sent only to `api.github.com`, never logged, and never returned by tools.

## Tools (21)

All inputs are Zod-validated. Original tools keep their text format; newer tools return JSON text + MCP `structuredContent`.

### Core / exploration

| Tool | Purpose | Key args |
|---|---|---|
| `ping` | Connection check | none |
| `get_repo_info` | Repository metadata | `owner`, `repo` |
| `get_commits` | Recent commits | `owner`, `repo`, `branch?`, `limit?` |
| `list_issues` | Issues only (PRs filtered) | `owner`, `repo`, `state`, `limit?` |
| `list_pull_requests` | PR list | `owner`, `repo`, `state`, `limit?` |
| `get_repo_languages` | Language byte/share breakdown | `owner`, `repo` |
| `get_repo_readme` | Decoded README | `owner`, `repo` |
| `get_repo_tree` | Tree traversal with truncation flags | `owner`, `repo`, `ref?`, `path?`, `max_depth?`, `limit?` |
| `get_file_content` | File read with line range/binary handling | `owner`, `repo`, `path`, `ref?`, `start_line?`, `end_line?` |
| `search_code` | GitHub code search (token required) | `owner`, `repo`, `query`, `language?`, `extension?`, `limit?` |

### Intelligence

| Tool | Purpose | Key args |
|---|---|---|
| `get_repo_dependencies` | Declared dependencies from manifests | `owner`, `repo`, `ref?` |
| `get_contributors` | Contributors + pagination | `owner`, `repo`, `page?`, `limit?` |
| `get_commit_details` | Commit stats/files/patches | `owner`, `repo`, `sha` |
| `get_pr_details` | PR metadata/files/reviews/merge status | `owner`, `repo`, `pull_number` |
| `analyze_repository` | Composite report; optional source analysis | `owner`, `repo`, `ref?`, `include_activity?`, `include_dependencies?`, `include_source_analysis?`, `max_analysis_files?` |

### Static source analysis

| Tool | Purpose | Key args |
|---|---|---|
| `get_file_symbols` | Declarations, signatures, visibility, docs, syntax errors | `owner`, `repo`, `path`, `ref?`, `kind?`, `max_symbols?` |
| `get_file_outline` | Hierarchical declaration outline | `owner`, `repo`, `path`, `ref?`, `max_symbols?` |
| `get_file_imports` | Syntax-derived imports/requires/includes | `owner`, `repo`, `path`, `ref?`, `classification?`, `max_imports?` |
| `get_file_exports` | Explicit/public/inferred export candidates | `owner`, `repo`, `path`, `ref?`, `category?`, `max_exports?` |
| `find_symbol` | Bounded repo-wide symbol lookup (no GitHub code search) | `owner`, `repo`, `name`, `ref?`, `path?`, `language?`, `kind?`, `partial?`, `case_sensitive?`, `max_files?`, `limit?` |
| `get_code_metrics` | Lines, declarations, nesting, largest functions, estimated complexity | `owner`, `repo`, `path`, `ref?`, `include_functions?`, `max_functions?` |

## Supported analysis languages

| Language | Extensions | Notes |
|---|---|---|
| JavaScript | `.js`, `.mjs`, `.cjs` | ESM + CommonJS patterns |
| JSX | `.jsx` | JS grammar |
| TypeScript | `.ts`, `.mts`, `.cts` | Interfaces/types/enums/overloads |
| TSX | `.tsx` | TSX grammar |
| Python | `.py`, `.pyi` | `__all__` explicit; non-private top-level inferred candidates |
| Java | `.java` | Public/protected visibility exports |
| Rust | `.rs` | `pub` visibility/use paths |
| C | `.c`, `.h` | Conservative inferred linkage candidates |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx` | Conservative inferred candidates |

Complexity is an estimated decision-node count, not compiler-proven CFG complexity.

## Configuration

Environment variables (defaults shown):

| Variable | Default | Purpose |
|---|---:|---|
| `GITHUB_TOKEN` | unset | Auth; required for `search_code` |
| `REPOLENS_TIMEOUT_MS` | `10000` | GitHub request timeout |
| `REPOLENS_MAX_RESPONSE_BYTES` | `5242880` | Response body cap |
| `REPOLENS_MAX_FILE_BYTES` | `524288` | File/content fetch cap |
| `REPOLENS_MAX_README_BYTES` | `65536` | README cap |
| `REPOLENS_MAX_TREE_ENTRIES` | `500` | Tree/manifest bound |
| `REPOLENS_MAX_PATCH_CHARS` | `4000` | Diff patch cap |
| `REPOLENS_MAX_CONCURRENCY` | `4` | Concurrent GitHub requests |
| `REPOLENS_MAX_RETRIES` | `2` | Retries for network/timeout/5xx |
| `REPOLENS_RETRY_DELAY_MS` | `250` | Backoff base |
| `REPOLENS_CACHE_TTL_MS` | `60000` | GitHub cache TTL (`0` disables) |
| `REPOLENS_CACHE_MAX_ENTRIES` | `200` | GitHub cache size |
| `REPOLENS_MAX_ANALYSIS_SOURCE_BYTES` | `262144` | Per-file analysis bytes |
| `REPOLENS_MAX_ANALYSIS_NODES` | `100000` | AST/query node bound |
| `REPOLENS_MAX_ANALYSIS_SYMBOLS` | `500` | Declarations per file |
| `REPOLENS_ANALYSIS_PARSE_TIMEOUT_MS` | `1500` | Parse timeout |
| `REPOLENS_MAX_ANALYSIS_FILES` | `20` | Repo source-analysis file cap |
| `REPOLENS_MAX_SYMBOL_SEARCH_FILES` | `50` | `find_symbol` file cap |
| `REPOLENS_MAX_SYMBOL_SEARCH_BYTES` | `2097152` | `find_symbol` byte budget |
| `REPOLENS_SYMBOL_SEARCH_TIMEOUT_MS` | `5000` | `find_symbol` time budget |
| `REPOLENS_ANALYSIS_CACHE_TTL_MS` | `60000` | Analysis cache TTL |
| `REPOLENS_ANALYSIS_CACHE_MAX_ENTRIES` | `100` | Analysis cache size |

## Security and safety

- Read-only GitHub REST access only; requests restricted to `https://api.github.com`.
- No repository code/build scripts/manifests are executed. Static analysis is AST-only.
- Repo content (code, README, comments, commits, issues/PRs, patches, symbols, imports) is treated as **untrusted data**, not instructions.
- Tokens are redacted from errors/logs; cache keys never include token values.
- stdout is MCP protocol only; diagnostics go to stderr.

## Limitations

- GitHub tree/contents/code-search APIs can be truncated, rate-limited, or require auth; RepoLens reports this explicitly.
- `find_symbol` is a bounded local AST scan, not a full semantic index.
- Dependency detection is manifest-based and declared-only (no lockfile/transitive resolution).
- Static analysis is syntax/AST-based; no semantic type checking, full resolution, or runtime behavior proof.
- C/C++ exports and complexity metrics are conservative/estimated where semantics are ambiguous.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tools missing in OpenCode | `npm run build`, `opencode mcp list`, then `/reload` |
| `search_code` needs token | Set `GITHUB_TOKEN` |
| Rate limit / timeout | Wait/reset, authenticate, or increase timeout within bounds |
| Analysis truncated/incomplete | Narrow path/language, reduce scope, or raise bounded limits |
| Unsupported language | Check supported extensions above; result includes explicit error |

## Development

```bash
npm run typecheck
npm run build
npm test
```

Project layout: `src/analysis/`, `src/github/`, `src/services/`, `src/tools/`, `src/utils/`, `tests/`. See `CHANGELOG.md` for release notes. No commits/pushes are made automatically.