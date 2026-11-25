import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHubClient, GitHubError } from "../dist/github/client.js";
import { getTreeOverview } from "../dist/services/repository.js";
import { parseManifest } from "../dist/services/dependencyParser.js";
import { createInMemoryClient, createMockFetch } from "./helpers.js";

const repo = {
  name: "r",
  full_name: "o/r",
  description: "test repo",
  owner: { login: "o" },
  language: "TypeScript",
  stargazers_count: 1,
  forks_count: 1,
  open_issues_count: 0,
  default_branch: "main",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  html_url: "https://github.com/o/r",
  license: { name: "MIT License", spdx_id: "MIT" },
  visibility: "public",
  private: false,
};

function clientFor(handler, options = {}) {
  const { fetchImpl, calls } = createMockFetch(handler);
  return {
    calls,
    client: new GitHubClient({
      fetchImpl,
      cacheTtlMs: 0,
      maxRetries: 0,
      ...options,
    }),
  };
}

const tree = {
  sha: "tree-sha",
  truncated: false,
  tree: [
    { path: "README.md", mode: "100644", type: "blob", sha: "a", size: 20 },
    { path: "src", mode: "040000", type: "tree", sha: "b" },
    { path: "src/index.ts", mode: "100644", type: "blob", sha: "c", size: 120 },
    { path: "src/lib", mode: "040000", type: "tree", sha: "d" },
    { path: "src/lib/util.ts", mode: "100644", type: "blob", sha: "e", size: 50 },
    { path: "docs/guide.md", mode: "100644", type: "blob", sha: "f", size: 30 },
  ],
};

function treeRepoHandler(url) {
  if (url.pathname === "/repos/o/r") return { body: repo };
  if (url.pathname === "/repos/o/r/git/trees/main") return { body: tree };
  if (url.pathname === "/repos/o/r/contents/src") {
    return { body: [{ path: "src", type: "tree", sha: "b", name: "src" }] };
  }
  throw new Error(`Unexpected request: ${url.pathname}`);
}

test("get_repo_tree resolves the default ref and applies depth and local bounds", async () => {
  const { client, calls } = clientFor(treeRepoHandler);
  const overview = await getTreeOverview(client, "o", "r", { maxDepth: 2, limit: 3 });

  assert.equal(overview.ref, "main");
  assert.equal(overview.treeSha, "tree-sha");
  assert.deepEqual(overview.entries.map((entry) => entry.path), [
    "README.md",
    "docs/guide.md",
    "src",
  ]);
  assert.equal(overview.totalReturned, 3);
  assert.equal(overview.truncated, true);
  assert.equal(calls[0].url.pathname, "/repos/o/r");
  assert.equal(calls[1].url.searchParams.get("recursive"), "1");
});

test("get_repo_tree handles nested directories and reports source truncation", async () => {
  const { client } = clientFor((url) => {
    if (url.pathname === "/repos/o/r/git/trees/main") {
      return { body: { ...tree, truncated: true } };
    }
    return treeRepoHandler(url);
  });
  const overview = await getTreeOverview(client, "o", "r", {
    ref: "main",
    path: "src",
    maxDepth: 1,
  });

  assert.deepEqual(overview.entries.map((entry) => entry.path), ["src", "src/index.ts", "src/lib"]);
  assert.equal(overview.sourceTruncated, true);
  assert.equal(overview.truncated, true);
  assert.equal(overview.requestedPath, "src");
});

test("get_repo_tree rejects invalid refs and paths", async () => {
  const { client, calls } = clientFor(treeRepoHandler);
  await assert.rejects(
    () => getTreeOverview(client, "o", "r", { ref: "../secret" }),
    (error) => error instanceof GitHubError && error.kind === "validation",
  );
  await assert.rejects(
    () => getTreeOverview(client, "o", "r", { path: "/etc" }),
    (error) => error instanceof GitHubError && error.kind === "validation",
  );
  assert.equal(calls.length, 0);
});

test("get_file_content decodes base64, extracts line ranges, and numbers lines", async (t) => {
  const content = "line one\nline two\nline three\n";
  const { client } = clientFor((url) => {
    if (url.pathname === "/repos/o/r/contents/src/index.ts") {
      return {
        body: {
          path: "src/index.ts",
          type: "file",
          encoding: "base64",
          size: Buffer.byteLength(content),
          sha: "file-sha",
          content: Buffer.from(content, "utf8").toString("base64").replace(/(.{12})/g, "$1\n"),
          html_url: "https://github.com/o/r/blob/main/src/index.ts",
        },
      };
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const response = await mcp.request("tools/call", {
    name: "get_file_content",
    arguments: { owner: "o", repo: "r", path: "src/index.ts", ref: "main", start_line: 2, end_line: 3 },
  });
  assert.equal(response.result.isError, undefined);
  const result = response.result.structuredContent;
  assert.equal(result.path, "src/index.ts");
  assert.equal(result.size, Buffer.byteLength(content));
  assert.match(result.url, /blob\/main\/src\/index\.ts/);
  assert.equal(result.binary, false);
  assert.deepEqual(result.lineRange, {
    startLine: 2,
    endLine: 3,
    requestedEndLine: 3,
    truncated: false,
  });
  assert.deepEqual(result.returnedLines, [
    { number: 2, content: "line two" },
    { number: 3, content: "line three" },
  ]);
  assert.deepEqual(response.result.content[0].text.match(/line two/g)?.length, 2);
});

test("get_file_content omits binary data and reports byte truncation", async (t) => {
  const binary = Buffer.from([0x00, 0x01, 0x02, 0xff]);
  const { client } = clientFor((url) => {
    const path = url.pathname.split("/").pop();
    if (path === "image.bin") {
      return {
        body: {
          path: "image.bin",
          type: "file",
          encoding: "base64",
          size: binary.length,
          sha: "bin",
          content: binary.toString("base64"),
        },
      };
    }
    return {
      body: {
        path: "large.txt",
        type: "file",
        encoding: "base64",
        size: 100,
        sha: "large",
        content: Buffer.from("abcdefghijklmnopqrstuvwxyz", "utf8").toString("base64"),
      },
    };
  });
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const binaryResponse = await mcp.request("tools/call", {
    name: "get_file_content",
    arguments: { owner: "o", repo: "r", path: "image.bin" },
  });
  const binaryResult = binaryResponse.result.structuredContent;
  assert.equal(binaryResult.binary, true);
  assert.equal(binaryResult.content, "(binary file; raw bytes omitted)");
  assert.deepEqual(binaryResult.returnedLines, []);

  const small = clientFor(
    () => ({
      body: {
        path: "large.txt",
        type: "file",
        encoding: "base64",
        size: 100,
        sha: "large",
        content: Buffer.from("abcdefghijklmnopqrstuvwxyz", "utf8").toString("base64"),
      },
    }),
    { maxFileBytes: 10 },
  ).client;
  const raw = await small.getFile("o", "r", "large.txt");
  assert.equal(raw.content, "abcdefghij");
  assert.equal(raw.truncated, true);
  assert.equal(raw.size, 100);
});

test("get_file_content rejects unsupported encodings and invalid line ranges", async (t) => {
  const { client } = clientFor(() => ({
    body: {
      path: "weird.txt",
      type: "file",
      encoding: "git-lfs",
      size: 4,
      sha: "x",
      content: "pointer",
    },
  }));
  await assert.rejects(
    () => client.getFile("o", "r", "weird.txt"),
    (error) => error.kind === "invalid-response",
  );

  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());
  const invalid = await mcp.request("tools/call", {
    name: "get_file_content",
    arguments: { owner: "o", repo: "r", path: "weird.txt", start_line: 5, end_line: 2 },
  });
  assert.ok(invalid.error !== undefined || invalid.result.isError === true);
});

test("search_code requires a token and reports API failures honestly", async (t) => {
  const anonymous = clientFor(() => ({ body: { total_count: 0, incomplete_results: false, items: [] } }));
  const mcp = await createInMemoryClient(anonymous.client);
  t.after(() => mcp.close());
  const denied = await mcp.request("tools/call", {
    name: "search_code",
    arguments: { owner: "o", repo: "r", query: "TODO" },
  });
  assert.equal(denied.result.isError, true);
  assert.match(denied.result.content[0].text, /requires GITHUB_TOKEN/);

  const limited = clientFor(() => ({ status: 403, headers: { "x-ratelimit-remaining": "0", "retry-after": "9" }, body: {} }), {
    token: "test-token",
  });
  const limitedMcp = await createInMemoryClient(limited.client);
  t.after(() => limitedMcp.close());
  const failed = await limitedMcp.request("tools/call", {
    name: "search_code",
    arguments: { owner: "o", repo: "r", query: "TODO" },
  });
  assert.equal(failed.result.isError, true);
  assert.match(failed.result.content[0].text, /rate limit/i);
});

test("search_code builds a scoped query and reports incomplete results", async (t) => {
  const { client, calls } = clientFor(
    () => ({
      body: {
        total_count: 3,
        incomplete_results: true,
        items: [
          { name: "a.ts", path: "src/a.ts", html_url: "url-a", text_matches: [{ fragment: "TODO here" }] },
          { name: "b.ts", path: "src/b.ts", html_url: "url-b" },
        ],
      },
    }),
    { token: "test-token" },
  );
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const response = await mcp.request("tools/call", {
    name: "search_code",
    arguments: { owner: "o", repo: "r", query: "TODO", language: "TypeScript", extension: ".ts", limit: 2 },
  });
  assert.equal(calls[0].url.pathname, "/search/code");
  const q = calls[0].url.searchParams.get("q");
  assert.match(q, /repo:o\/r/);
  assert.match(q, /language:TypeScript/);
  assert.match(q, /extension:ts/);
  const result = response.result.structuredContent;
  assert.equal(result.totalMatchCount, 3);
  assert.equal(result.returnedMatches, 2);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.matches[0].textMatches, [{ fragment: "TODO here" }]);
});

test("dependency parsers cover common ecosystems without executing manifests", () => {
  const pkg = parseManifest(
    "package.json",
    JSON.stringify({
      dependencies: { react: "^18.0.0", express: "4.18.2" },
      devDependencies: { vitest: "^1.0.0" },
      peerDependencies: { typescript: ">=5" },
    }),
  );
  assert.equal(pkg.ecosystem, "JavaScript/TypeScript");
  assert.deepEqual(pkg.production.map((dep) => dep.name), ["react", "express"]);
  assert.deepEqual(pkg.development.map((dep) => dep.name), ["vitest"]);
  assert.equal(pkg.other[0].kind, "peer");

  const requirements = parseManifest("requirements.txt", "# comment\nflask==2.3.0\nrequests>=2.0\npytest==7\n");
  assert.deepEqual(requirements.production.map((dep) => dep.name), ["flask", "requests", "pytest"]);

  const pyproject = parseManifest(
    "pyproject.toml",
    [
      '[project]',
      'dependencies = ["django>=4", "celery[redis]==5.2"]',
      '',
      '[project.optional-dependencies]',
      'dev = ["pytest>=7", "ruff"]',
      '',
      '[tool.poetry.group.dev.dependencies]',
      'mypy = "^1.0"',
      '',
    ].join("\n"),
  );
  assert.equal(pyproject.production[0].name, "django");
  assert.ok(pyproject.development.some((dep) => dep.name === "pytest"));
  assert.ok(pyproject.development.some((dep) => dep.name === "mypy"));

  const cargo = parseManifest(
    "Cargo.toml",
    '[dependencies]\nserde = "1.0"\ntokio = { version = "1", features = ["full"] }\n\n[dev-dependencies]\ncriterion = "0.5"\n',
  );
  assert.deepEqual(cargo.production.map((dep) => dep.name), ["serde", "tokio"]);
  assert.equal(cargo.development[0].name, "criterion");

  const pom = parseManifest(
    "pom.xml",
    '<project><dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-core</artifactId><version>6.0</version></dependency><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4</version><scope>test</scope></dependency></dependencies></project>',
  );
  assert.equal(pom.production[0].name, "org.springframework:spring-core");
  assert.equal(pom.development[0].name, "junit:junit");

  const gradle = parseManifest(
    "build.gradle.kts",
    'dependencies { implementation("com.google.guava:guava:32.0-jre"); testImplementation("junit:junit:4.13.2") }',
  );
  assert.equal(gradle.production[0].name, "com.google.guava:guava");
  assert.equal(gradle.development[0].name, "junit:junit");

  const go = parseManifest("go.mod", "module example.com/x\n\nrequire (\n github.com/gin-gonic/gin v1.9.1\n golang.org/x/text v0.9.0 // indirect\n)\n");
  assert.equal(go.production[0].name, "github.com/gin-gonic/gin");
  assert.equal(go.production[1].version, "v0.9.0");

  const composer = parseManifest(
    "composer.json",
    JSON.stringify({ require: { php: "^8.1", "laravel/framework": "^10.0" }, "require-dev": { phpunit: "^10" } }),
  );
  assert.equal(composer.packageManager, "Composer");
  assert.equal(composer.development[0].name, "phpunit");

  assert.throws(() => parseManifest("package.json", "not json"));
});
