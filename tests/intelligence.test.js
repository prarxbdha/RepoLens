import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHubClient } from "../dist/github/client.js";
import { createInMemoryClient, createMockFetch } from "./helpers.js";

const repo = {
  name: "r",
  full_name: "o/r",
  description: "A test repository",
  owner: { login: "o" },
  language: "TypeScript",
  stargazers_count: 10,
  forks_count: 2,
  open_issues_count: 1,
  default_branch: "main",
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  pushed_at: "2026-01-02T00:00:00Z",
  html_url: "https://github.com/o/r",
  license: { name: "MIT License", spdx_id: "MIT" },
  visibility: "public",
  private: false,
};

function mcpFor(handler, options = {}) {
  const { fetchImpl, calls } = createMockFetch(handler);
  const client = new GitHubClient({ fetchImpl, cacheTtlMs: 0, maxRetries: 0, ...options });
  return { calls, client };
}

test("get_contributors returns profile URLs, account types, and pagination state", async (t) => {
  const { client, calls } = mcpFor((url) => {
    if (url.searchParams.get("page") === "2") {
      return {
        body: [{ login: "grace", contributions: 7, html_url: "https://github.com/grace", type: "User" }],
      };
    }
    return {
      headers: { link: '<https://api.github.com/repos/o/r/contributors?page=2>; rel="next"' },
      body: [
        { login: "ada", contributions: 12, html_url: "https://github.com/ada", type: "User" },
        { login: "renovate", contributions: 3, html_url: "https://github.com/apps/renovate", type: "Bot" },
      ],
    };
  });
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const first = await mcp.request("tools/call", {
    name: "get_contributors",
    arguments: { owner: "o", repo: "r", limit: 2 },
  });
  const result = first.result.structuredContent;
  assert.equal(result.contributors[0].username, "ada");
  assert.equal(result.contributors[0].profileUrl, "https://github.com/ada");
  assert.equal(result.contributors[1].accountType, "Bot");
  assert.equal(result.hasNextPage, true);
  assert.equal(calls[0].url.pathname, "/repos/o/r/contributors");

  const second = await mcp.request("tools/call", {
    name: "get_contributors",
    arguments: { owner: "o", repo: "r", limit: 2, page: 2 },
  });
  assert.equal(second.result.structuredContent.hasNextPage, false);
  assert.equal(second.result.structuredContent.contributors[0].username, "grace");
});

test("get_commit_details reports parents, stats, and truncated patches", async (t) => {
  const { client } = mcpFor(() => ({
    body: {
      sha: "abcdef1234567890",
      html_url: "https://github.com/o/r/commit/abcdef1234567890",
      commit: {
        message: "Implement feature\n\nDetails",
        author: { name: "Ada", email: "ada@example.com", date: "2026-01-01T00:00:00Z" },
        committer: { name: "Ada", date: "2026-01-01T00:00:00Z" },
      },
      author: { login: "ada" },
      parents: [{ sha: "parent1" }, { sha: "parent2" }],
      stats: { additions: 100, deletions: 20, total: 120 },
      files: [
        { filename: "src/a.ts", status: "modified", additions: 80, deletions: 10, changes: 90, patch: "x".repeat(5_000) },
        { filename: "src/b.ts", status: "added", additions: 20, deletions: 10, changes: 30 },
      ],
    },
  }));
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const response = await mcp.request("tools/call", {
    name: "get_commit_details",
    arguments: { owner: "o", repo: "r", sha: "abcdef1234567890" },
  });
  const result = response.result.structuredContent;
  assert.equal(result.message, "Implement feature\n\nDetails");
  assert.deepEqual(result.parents, ["parent1", "parent2"]);
  assert.deepEqual(result.stats, { additions: 100, deletions: 20, total: 120 });
  assert.equal(result.changedFileCount, 2);
  assert.equal(result.changedFiles[0].patch.length, 4_000);
  assert.equal(result.changedFiles[0].patchTruncated, true);
  assert.equal(result.changedFiles[1].patch, null);
  assert.equal(result.patchesTruncated, true);
});

test("get_pr_details handles unavailable reviews without failing the whole request", async (t) => {
  const { client } = mcpFor((url) => {
    if (url.pathname === "/repos/o/r/pulls/12") {
      return {
        body: {
          number: 12,
          title: "Add feature",
          body: "Description from PR",
          state: "open",
          user: { login: "grace" },
          head: { ref: "feature", repo: { full_name: "o/r" } },
          base: { ref: "main" },
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
          html_url: "https://github.com/o/r/pull/12",
          merged: false,
          mergeable: true,
          mergeable_state: "clean",
          draft: false,
        },
      };
    }
    if (url.pathname === "/repos/o/r/pulls/12/files") {
      return {
        body: [
          {
            filename: "src/feature.ts",
            status: "modified",
            additions: 5,
            deletions: 1,
            changes: 6,
            patch: "@@ -1 +1 @@\n-old\n+new",
          },
        ],
      };
    }
    if (url.pathname === "/repos/o/r/pulls/12/reviews") {
      return { status: 403, body: { message: "Forbidden" } };
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const response = await mcp.request("tools/call", {
    name: "get_pr_details",
    arguments: { owner: "o", repo: "r", pull_number: 12 },
  });
  assert.equal(response.result.isError, undefined);
  const result = response.result.structuredContent;
  assert.equal(result.title, "Add feature");
  assert.equal(result.sourceBranch, "feature");
  assert.equal(result.targetBranch, "main");
  assert.equal(result.mergeStatus.mergeable, true);
  assert.equal(result.changedFiles[0].filename, "src/feature.ts");
  assert.deepEqual(result.reviews, []);
  assert.equal(result.incomplete, true);
  assert.match(result.errors[0], /reviews/);
});

function analysisHandler(url) {
  if (url.pathname === "/repos/o/r") return { body: repo };
  if (url.pathname === "/repos/o/r/languages") {
    return { body: { TypeScript: 800, CSS: 200 } };
  }
  if (url.pathname === "/repos/o/r/git/trees/main") {
    return {
      body: {
        sha: "tree",
        truncated: false,
        tree: [
          { path: "README.md", mode: "100644", type: "blob", sha: "1", size: 40 },
          { path: "package.json", mode: "100644", type: "blob", sha: "2", size: 80 },
          { path: "src/index.ts", mode: "100644", type: "blob", sha: "3", size: 120 },
          { path: "tests/app.test.ts", mode: "100644", type: "blob", sha: "4", size: 60 },
          { path: ".github/workflows/ci.yml", mode: "100644", type: "blob", sha: "5", size: 90 },
        ],
      },
    };
  }
  if (url.pathname === "/repos/o/r/readme") {
    return {
      body: {
        content: Buffer.from("# Readme", "utf8").toString("base64"),
        encoding: "base64",
        path: "README.md",
        html_url: "https://github.com/o/r/blob/main/README.md",
      },
    };
  }
  if (url.pathname === "/repos/o/r/contents/package.json") {
    const content = JSON.stringify({
      dependencies: { react: "^18.0.0" },
      devDependencies: { vitest: "^1.0.0" },
    });
    return {
      body: {
        path: "package.json",
        type: "file",
        encoding: "base64",
        size: Buffer.byteLength(content),
        sha: "manifest",
        content: Buffer.from(content, "utf8").toString("base64"),
      },
    };
  }
  if (url.pathname === "/repos/o/r/commits") {
    return {
      body: [
        {
          sha: "abc123",
          commit: { message: "Latest change", author: { name: "Ada", date: "2026-01-01T00:00:00Z" } },
          author: { login: "ada" },
          html_url: "https://github.com/o/r/commit/abc123",
        },
      ],
    };
  }
  if (url.pathname === "/repos/o/r/contributors") {
    return { body: [{ login: "ada", contributions: 9, html_url: "https://github.com/ada", type: "User" }] };
  }
  if (url.pathname === "/repos/o/r/pulls") {
    return { body: [] };
  }
  throw new Error(`Unexpected request: ${url.pathname}`);
}

test("analyze_repository combines structured context and labels heuristics", async (t) => {
  const { client } = mcpFor(analysisHandler);
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const response = await mcp.request("tools/call", {
    name: "analyze_repository",
    arguments: { owner: "o", repo: "r", ref: "main" },
  });
  assert.equal(response.result.isError, undefined);
  const result = response.result.structuredContent;
  assert.equal(result.identity.fullName, "o/r");
  assert.equal(result.identity.license.spdxId, "MIT");
  assert.equal(result.languages.primary, "TypeScript");
  assert.equal(result.languages.distribution[0].percentage, 80);
  assert.equal(result.structure.fileCount, 5);
  assert.equal(result.readme.available, true);
  assert.deepEqual(result.dependencies.ecosystems, ["JavaScript/TypeScript"]);
  assert.equal(result.dependencies.productionCount, 1);
  assert.equal(result.technologies.frameworkIndicators[0].name, "react");
  assert.deepEqual(result.entryPoints.paths, ["src/index.ts"]);
  assert.deepEqual(result.testing.paths, ["tests/app.test.ts"]);
  assert.deepEqual(result.ci.paths, [".github/workflows/ci.yml"]);
  assert.equal(result.entryPoints.inferred, true);
  assert.equal(result.activity.recentCommits[0].message, "Latest change");
  assert.equal(result.activity.pushedAt, "2026-01-02T00:00:00Z");
  assert.equal(result.incomplete, false);
  assert.match(result.inferredNote, /no repository code was executed/i);
  assert.equal(result.sourceAnalysis.requested, false);
});

test("analyze_repository survives partial section failures", async (t) => {
  const { client } = mcpFor((url) => {
    if (url.pathname === "/repos/o/r/languages") return { status: 500, body: {} };
    return analysisHandler(url);
  });
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const response = await mcp.request("tools/call", {
    name: "analyze_repository",
    arguments: {
      owner: "o",
      repo: "r",
      ref: "main",
      include_activity: false,
      include_dependencies: false,
    },
  });
  assert.equal(response.result.isError, undefined);
  const result = response.result.structuredContent;
  assert.equal(result.incomplete, true);
  assert.equal(result.errors[0].section, "languages");
  assert.deepEqual(result.languages.distribution, []);
  assert.equal(result.dependencies.available, false);
  assert.equal(result.activity.available, false);
  assert.equal(result.entryPoints.paths[0], "src/index.ts");
});

test("analyze_repository can include bounded source analysis", async (t) => {
  const { client } = mcpFor((url) => {
    if (url.pathname === "/repos/o/r/contents/src/index.ts") {
      const content = "export function hello(name: string): string { return name; }";
      return {
        body: {
          path: "src/index.ts",
          type: "file",
          encoding: "base64",
          size: content.length,
          sha: "ts1",
          content: Buffer.from(content, "utf8").toString("base64"),
        },
      };
    }
    if (url.pathname === "/repos/o/r/contents/README.md") {
      const content = "# Readme";
      return {
        body: {
          path: "README.md",
          type: "file",
          encoding: "base64",
          size: content.length,
          sha: "md1",
          content: Buffer.from(content, "utf8").toString("base64"),
        },
      };
    }
    return analysisHandler(url);
  });
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const response = await mcp.request("tools/call", {
    name: "analyze_repository",
    arguments: { owner: "o", repo: "r", ref: "main", include_source_analysis: true, max_analysis_files: 5 },
  });
  assert.equal(response.result.isError, undefined);
  const result = response.result.structuredContent;
  assert.equal(result.sourceAnalysis.requested, true);
  assert.equal(result.sourceAnalysis.filesAnalyzed, 1);
  assert.equal(result.sourceAnalysis.aggregate.functions, 1);
  assert.equal(result.sourceAnalysis.files[0].path, "src/index.ts");
  assert.equal(result.sourceAnalysis.truncated, false);
});
