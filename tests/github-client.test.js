import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GITHUB_API_BASE,
  GitHubClient,
  GitHubError,
  redactToken,
} from "../dist/github/client.js";
import { createMockFetch } from "./helpers.js";

const repo = {
  name: "Hello-World",
  full_name: "octocat/Hello-World",
  description: "My first repository on GitHub!",
  owner: { login: "octocat" },
  language: " TypeScript ",
  stargazers_count: 100,
  forks_count: 10,
  open_issues_count: 3,
  default_branch: "master",
  created_at: "2011-01-26T19:01:12Z",
  updated_at: "2026-01-01T00:00:00Z",
  html_url: "https://github.com/octocat/Hello-World",
  license: { name: "MIT License", spdx_id: "MIT" },
  visibility: "public",
  private: false,
};

function kindOf(error) {
  return error instanceof GitHubError ? error.kind : undefined;
}

test("requests use the official API, required headers, and optional token", async () => {
  const { fetchImpl, calls } = createMockFetch(() => ({ body: repo }));
  const client = new GitHubClient({ fetchImpl, token: "test-token-123" });

  const result = await client.getRepository("octocat", "Hello-World");

  assert.equal(result.full_name, "octocat/Hello-World");
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url.origin, GITHUB_API_BASE);
  assert.equal(url.pathname, "/repos/octocat/Hello-World");
  assert.equal(init.method, "GET");
  assert.equal(init.headers.Accept, "application/vnd.github+json");
  assert.equal(init.headers["X-GitHub-Api-Version"], "2022-11-28");
  assert.equal(init.headers["User-Agent"], "repolens/0.1.0");
  assert.equal(init.headers.Authorization, "Bearer test-token-123");
  assert.ok(init.signal);
  assert.equal(
    redactToken("token test-token-123 leaked", "test-token-123"),
    "token [REDACTED] leaked",
  );
});

test("unauthenticated mode omits the Authorization header", async () => {
  const { fetchImpl, calls } = createMockFetch(() => ({ body: repo }));
  const client = new GitHubClient({ fetchImpl, token: "" });
  await client.getRepository("octocat", "Hello-World");
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test("validates owner, repository, branch and limit before requesting", async () => {
  const { fetchImpl, calls } = createMockFetch(() => ({ body: repo }));
  const client = new GitHubClient({ fetchImpl });

  await assert.rejects(() => client.getRepository("../etc", "repo"), (error) => kindOf(error) === "validation");
  await assert.rejects(() => client.getRepository("owner", "bad/name"), (error) => kindOf(error) === "validation");
  await assert.rejects(
    () => client.getCommits("owner", "repo", { branch: "bad\nbranch" }),
    (error) => kindOf(error) === "validation",
  );
  await assert.rejects(
    () => client.getCommits("owner", "repo", { limit: 51 }),
    (error) => kindOf(error) === "validation",
  );
  assert.equal(calls.length, 0);
});

test("get_commits encodes the branch and per_page query parameters", async () => {
  const commits = [
    {
      sha: "abc123def456",
      commit: { message: "Fix bug\n\nDetails", author: { name: "Ada", date: "2026-01-01T00:00:00Z" } },
      author: { login: "ada" },
      html_url: "https://github.com/o/r/commit/abc123def456",
    },
  ];
  const { fetchImpl, calls } = createMockFetch(() => ({ body: commits }));
  const client = new GitHubClient({ fetchImpl });

  const result = await client.getCommits("octocat", "Hello-World", { branch: "feature/fix", limit: 5 });

  assert.equal(result.length, 1);
  assert.equal(calls[0].url.searchParams.get("sha"), "feature/fix");
  assert.equal(calls[0].url.searchParams.get("per_page"), "5");
});

test("list_issues excludes pull requests and respects the limit", async () => {
  const items = [
    { number: 9, title: "PR item", pull_request: { url: "x" } },
    { number: 8, title: "Issue A" },
    { number: 7, title: "Another PR", pull_request: {} },
    { number: 6, title: "Issue B" },
    { number: 5, title: "Issue C" },
  ];
  const { fetchImpl, calls } = createMockFetch(() => ({ body: items }));
  const client = new GitHubClient({ fetchImpl });

  const result = await client.listIssues("o", "r", { state: "all", limit: 2 });

  assert.deepEqual(result.map((issue) => issue.number), [8, 6]);
  assert.equal(calls[0].url.searchParams.get("per_page"), "4");
  assert.equal(calls[0].url.searchParams.get("state"), "all");
});

test("list_pull_requests uses the pulls endpoint and state filter", async () => {
  const pulls = [
    {
      number: 12,
      title: "Add feature",
      state: "open",
      user: { login: "grace" },
      head: { ref: "feature" },
      base: { ref: "main" },
      created_at: "2026-02-01T00:00:00Z",
      html_url: "https://github.com/o/r/pull/12",
    },
  ];
  const { fetchImpl, calls } = createMockFetch(() => ({ body: pulls }));
  const client = new GitHubClient({ fetchImpl });

  const result = await client.listPullRequests("o", "r", { state: "open", limit: 10 });

  assert.equal(result[0].head.ref, "feature");
  assert.equal(calls[0].url.pathname, "/repos/o/r/pulls");
  assert.equal(calls[0].url.searchParams.get("state"), "open");
});

test("get_languages returns the byte map", async () => {
  const { fetchImpl, calls } = createMockFetch(() => ({ body: { TypeScript: 750, CSS: 250 } }));
  const client = new GitHubClient({ fetchImpl });
  assert.deepEqual(await client.getLanguages("o", "r"), { TypeScript: 750, CSS: 250 });
  assert.equal(calls[0].url.pathname, "/repos/o/r/languages");
});

test("get_readme decodes base64 content and truncates oversized files", async () => {
  const content = "# Title\n".repeat(200);
  const encoded = Buffer.from(content, "utf8").toString("base64").replace(/(.{20})/g, "$1\n");
  const { fetchImpl } = createMockFetch(() => ({
    body: {
      content: encoded,
      encoding: "base64",
      path: "README.md",
      html_url: "https://github.com/o/r/blob/main/README.md",
    },
  }));
  const client = new GitHubClient({ fetchImpl, maxReadmeBytes: 64 });

  const readme = await client.getReadme("o", "r");

  assert.equal(readme.path, "README.md");
  assert.equal(readme.bytes, Buffer.byteLength(content, "utf8"));
  assert.equal(readme.truncated, true);
  assert.equal(Buffer.byteLength(readme.content, "utf8"), 64);
  assert.match(readme.content, /^# Title/);
});

test("get_readme rejects unsupported encodings and invalid payloads", async () => {
  const client = new GitHubClient({
    fetchImpl: createMockFetch(() => ({
      body: { content: "aGVsbG8=", encoding: "utf-8", path: "README.md", html_url: "u" },
    })).fetchImpl,
  });
  await assert.rejects(() => client.getReadme("o", "r"), (error) => kindOf(error) === "invalid-response");

  const invalid = new GitHubClient({
    fetchImpl: createMockFetch(() => ({
      body: { content: "!!!", encoding: "base64", path: "README.md", html_url: "u" },
    })).fetchImpl,
  });
  await assert.rejects(() => invalid.getReadme("o", "r"), (error) => kindOf(error) === "invalid-response");
});

test("HTTP errors become typed errors without crashing the client", async () => {
  const client = new GitHubClient({
    fetchImpl: createMockFetch(() => ({ status: 404, body: { message: "Not Found" } })).fetchImpl,
  });
  await assert.rejects(
    () => client.getRepository("o", "missing"),
    (error) => error.kind === "http" && error.status === 404,
  );
});

test("403 with no remaining requests and 429 are rate-limit errors", async () => {
  const headers = {
    "x-ratelimit-limit": "60",
    "x-ratelimit-remaining": "0",
    "x-ratelimit-reset": "1767225600",
    "retry-after": "12",
  };
  for (const status of [403, 429]) {
    const client = new GitHubClient({
      fetchImpl: createMockFetch(() => ({ status, body: {}, headers })).fetchImpl,
    });
    await assert.rejects(
      () => client.getRepository("o", "r"),
      (error) => {
        assert.equal(error.kind, "rate-limit");
        assert.equal(error.rateLimit.remaining, 0);
        assert.equal(error.rateLimit.retryAfterSeconds, 12);
        assert.match(error.message, /rate limit exceeded/i);
        return true;
      },
    );
  }
});

test("network failures and timeouts are reported clearly", async () => {
  const network = new GitHubClient({
    fetchImpl: createMockFetch(() => {
      throw new TypeError("fetch failed");
    }).fetchImpl,
  });
  await assert.rejects(() => network.getRepository("o", "r"), (error) => error.kind === "network");

  const timeoutClient = new GitHubClient({
    timeoutMs: 20,
    fetchImpl: createMockFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    ).fetchImpl,
  });
  await assert.rejects(() => timeoutClient.getRepository("o", "r"), (error) => error.kind === "timeout");
});

test("network errors never include the configured token", async () => {
  const { fetchImpl } = createMockFetch(() => {
    throw new Error("failed with test-token-456");
  });
  const client = new GitHubClient({ fetchImpl, token: "test-token-456" });
  await assert.rejects(
    () => client.getRepository("o", "r"),
    (error) => !error.message.includes("test-token-456") && error.message.includes("[REDACTED]"),
  );
});

test("malformed JSON and unexpected shapes are invalid responses", async () => {
  const malformed = new GitHubClient({
    fetchImpl: createMockFetch(() => ({ body: "not json" })).fetchImpl,
  });
  await assert.rejects(() => malformed.getRepository("o", "r"), (error) => error.kind === "invalid-response");

  const wrongShape = new GitHubClient({
    fetchImpl: createMockFetch(() => ({ body: { unexpected: true } })).fetchImpl,
  });
  await assert.rejects(() => wrongShape.getCommits("o", "r"), (error) => error.kind === "invalid-response");
});
