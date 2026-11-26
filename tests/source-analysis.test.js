import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { GitHubClient } from "../dist/github/client.js";
import { analyzeSource, clearAnalysisCache } from "../dist/analysis/parser.js";
import { detectLanguage } from "../dist/analysis/languageRegistry.js";
import { createInMemoryClient, createMockFetch } from "./helpers.js";

function fixture(name) {
  return readFileSync(fileURLToPath(new URL(`./fixtures/source/${name}`, import.meta.url)), "utf8");
}

function mcpFor(handler, options = {}) {
  const { fetchImpl, calls } = createMockFetch(handler);
  const client = new GitHubClient({ fetchImpl, cacheTtlMs: 0, maxRetries: 0, ...options });
  return { calls, client };
}

const languageCases = [
  ["sample.js", "javascript", ["function:add", "class:Calculator", "method:multiply@Calculator", "constructor:constructor@Calculator"]],
  ["sample.ts", "typescript", ["interface:Repository", "enum:Status", "method:find@Service", "function:bootstrap"]],
  ["sample.tsx", "tsx", ["interface:CardProps", "function:Card", "class:Badge"]],
  ["sample.jsx", "jsx", ["function:Panel", "class:Note", "method:render@Note"]],
  ["sample.py", "python", ["class:AsyncWorker", "method:compute@AsyncWorker", "function:_private"]],
  ["sample.java", "java", ["class:Service", "constructor:Service@Service", "method:find@Service", "enum:State@Service"]],
  ["sample.rs", "rust", ["struct:Repository", "trait:Findable", "method:load@Repository", "function:top@nested"]],
  ["sample.c", "c", ["struct:Item", "function:add", "function:reset"]],
  ["sample.cpp", "cpp", ["class:Widget@ui", "constructor:Widget@Widget", "method:render@Widget", "function:count_points@ui"]],
];

test("Tree-sitter analysis supports all required languages", async (t) => {
  for (const [file, languageId, expected] of languageCases) {
    await t.test(`parses ${file}`, async () => {
      const result = await analyzeSource(fixture(file), { languageId });
      assert.equal(result.supported, true);
      assert.equal(result.language, languageId);
      assert.equal(result.incomplete, false);
      assert.equal(result.syntaxErrors.length, 0);
      const ids = result.symbols.map((s) => `${s.kind}:${s.name}${s.parentName ? `@${s.parentName}` : ""}`);
      for (const symbol of expected) assert.ok(ids.includes(symbol), `${file} missing ${symbol}: ${ids.join(", ")}`);
      assert.ok(result.metrics.totalLines > 0);
      assert.ok(result.imports.length > 0 || ["unicode.ts"].includes(file));
    });
  }
});

test("analysis handles malformed, empty, unicode, and unsupported files", async () => {
  const malformed = await analyzeSource(fixture("malformed.ts"), { languageId: "typescript" });
  assert.equal(malformed.supported, true);
  assert.ok(malformed.syntaxErrors.length > 0);
  assert.equal(malformed.incomplete, true);

  const empty = await analyzeSource(fixture("empty.py"), { languageId: "python" });
  assert.equal(empty.supported, true);
  assert.equal(empty.symbols.length, 0);
  assert.equal(empty.syntaxErrors.length, 0);

  const unicode = await analyzeSource(fixture("unicode.ts"), { languageId: "typescript" });
  assert.equal(unicode.supported, true);
  assert.ok(unicode.symbols.some((s) => s.name === "café"));

  const unsupported = await analyzeSource(fixture("unsupported.txt"), { languageId: "txt" });
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.errors[0].kind, "unsupported-language");
});

test("detectLanguage maps extensions and rejects unknown", () => {
  assert.equal(detectLanguage("a.ts")?.id, "typescript");
  assert.equal(detectLanguage("a.tsx")?.id, "tsx");
  assert.equal(detectLanguage("a.jsx")?.id, "jsx");
  assert.equal(detectLanguage("a.py")?.id, "python");
  assert.equal(detectLanguage("a.java")?.id, "java");
  assert.equal(detectLanguage("a.rs")?.id, "rust");
  assert.equal(detectLanguage("a.c")?.id, "c");
  assert.equal(detectLanguage("a.cpp")?.id, "cpp");
  assert.equal(detectLanguage("a.txt"), null);
});

test("analysis cache reuses results by content hash", async () => {
  clearAnalysisCache();
  const source = fixture("sample.js");
  const first = await analyzeSource(source, { languageId: "javascript" });
  const second = await analyzeSource(source, { languageId: "javascript" });
  assert.deepEqual(second.symbols, first.symbols);
  assert.equal(second.contentHash, first.contentHash);
});

test("source analysis MCP tools return structured results", async (t) => {
  const files = {
    "src/sample.js": fixture("sample.js"),
    "src/sample.py": fixture("sample.py"),
    "src/malformed.ts": fixture("malformed.ts"),
  };
  const { client, calls } = mcpFor((url) => {
    if (url.pathname === "/repos/o/r/contents/src/sample.js") {
      return { body: { path: "src/sample.js", type: "file", encoding: "base64", size: files["src/sample.js"].length, sha: "sha-js", content: Buffer.from(files["src/sample.js"]).toString("base64") } };
    }
    if (url.pathname === "/repos/o/r/contents/src/sample.py") {
      return { body: { path: "src/sample.py", type: "file", encoding: "base64", size: files["src/sample.py"].length, sha: "sha-py", content: Buffer.from(files["src/sample.py"]).toString("base64") } };
    }
    if (url.pathname === "/repos/o/r/contents/src/malformed.ts") {
      return { body: { path: "src/malformed.ts", type: "file", encoding: "base64", size: files["src/malformed.ts"].length, sha: "sha-bad", content: Buffer.from(files["src/malformed.ts"]).toString("base64") } };
    }
    throw new Error(`Unexpected ${url.pathname}`);
  });
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const symbols = await mcp.request("tools/call", {
    name: "get_file_symbols",
    arguments: { owner: "o", repo: "r", path: "src/sample.js" },
  });
  assert.equal(symbols.result.isError, undefined);
  const s = symbols.result.structuredContent;
  assert.equal(s.language, "javascript");
  assert.ok(s.symbols.some((x) => x.name === "Calculator" && x.kind === "class"));
  assert.ok(s.untrustedData);

  const outline = await mcp.request("tools/call", {
    name: "get_file_outline",
    arguments: { owner: "o", repo: "r", path: "src/sample.js" },
  });
  const o = outline.result.structuredContent;
  assert.ok(o.outline.some((node) => node.name === "Calculator" && node.children.some((c) => c.name === "multiply")));

  const imports = await mcp.request("tools/call", {
    name: "get_file_imports",
    arguments: { owner: "o", repo: "r", path: "src/sample.js" },
  });
  const im = imports.result.structuredContent;
  assert.ok(im.imports.some((i) => i.module === "node:fs"));
  assert.ok(im.importCount >= 3);

  const exportsTool = await mcp.request("tools/call", {
    name: "get_file_exports",
    arguments: { owner: "o", repo: "r", path: "src/sample.js" },
  });
  const ex = exportsTool.result.structuredContent;
  assert.ok(ex.exports.some((e) => e.name === "add" && e.category === "explicit-module-export"));

  const metrics = await mcp.request("tools/call", {
    name: "get_code_metrics",
    arguments: { owner: "o", repo: "r", path: "src/sample.js" },
  });
  const m = metrics.result.structuredContent.metrics;
  assert.equal(m.functionCount, 4);
  assert.equal(m.classCount, 1);
  assert.ok(m.largestFunctions.length > 0);

  const malformedCall = await mcp.request("tools/call", {
    name: "get_file_symbols",
    arguments: { owner: "o", repo: "r", path: "src/malformed.ts" },
  });
  const bad = malformedCall.result.structuredContent;
  assert.ok(bad.syntaxErrors.length > 0);
  assert.equal(bad.incomplete, true);

  assert.ok(calls.every((c) => c.url.origin === "https://api.github.com"));
});

test("find_symbol searches bounded repository files without GitHub code search", async (t) => {
  const repo = {
    name: "r", full_name: "o/r", description: null, owner: { login: "o" }, language: "TypeScript",
    stargazers_count: 0, forks_count: 0, open_issues_count: 0, default_branch: "main",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    html_url: "https://github.com/o/r", license: null, visibility: "public", private: false,
  };
  const js = fixture("sample.js");
  const py = fixture("sample.py");
  const { client, calls } = mcpFor((url) => {
    if (url.pathname === "/repos/o/r") return { body: repo };
    if (url.pathname === "/repos/o/r/git/trees/main") {
      return { body: { sha: "tree", truncated: false, tree: [
        { path: "src/sample.js", type: "blob", mode: "100644", sha: "a", size: js.length },
        { path: "src/sample.py", type: "blob", mode: "100644", sha: "b", size: py.length },
        { path: "README.md", type: "blob", mode: "100644", sha: "c", size: 10 },
      ] } };
    }
    if (url.pathname === "/repos/o/r/contents/src/sample.js") {
      return { body: { path: "src/sample.js", type: "file", encoding: "base64", size: js.length, sha: "a", content: Buffer.from(js).toString("base64") } };
    }
    if (url.pathname === "/repos/o/r/contents/src/sample.py") {
      return { body: { path: "src/sample.py", type: "file", encoding: "base64", size: py.length, sha: "b", content: Buffer.from(py).toString("base64") } };
    }
    throw new Error(`Unexpected ${url.pathname}`);
  });
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const response = await mcp.request("tools/call", {
    name: "find_symbol",
    arguments: { owner: "o", repo: "r", name: "AsyncWorker", partial: false },
  });
  assert.equal(response.result.isError, undefined);
  const result = response.result.structuredContent;
  assert.equal(result.totalMatchesFound, 1);
  assert.equal(result.matches[0].symbol.name, "AsyncWorker");
  assert.equal(result.matches[0].path, "src/sample.py");
  assert.ok(!calls.some((c) => c.url.pathname === "/search/code"));
});
