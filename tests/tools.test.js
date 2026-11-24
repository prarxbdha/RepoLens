import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHubClient } from "../dist/github/client.js";
import { languageBreakdown } from "../dist/tools/languages.js";
import { createInMemoryClient, createMockFetch } from "./helpers.js";

const repo = {
  name: "Hello-World",
  full_name: "octocat/Hello-World",
  description: "My first repository on GitHub!",
  owner: { login: "octocat" },
  language: "TypeScript",
  stargazers_count: 100,
  forks_count: 10,
  open_issues_count: 3,
  default_branch: "main",
  created_at: "2011-01-26T19:01:12Z",
  updated_at: "2026-01-01T00:00:00Z",
  html_url: "https://github.com/octocat/Hello-World",
  license: { name: "MIT License", spdx_id: "MIT" },
  visibility: "public",
  private: false,
};

function clientFor(handler) {
  const { fetchImpl, calls } = createMockFetch(handler);
  return { client: new GitHubClient({ fetchImpl }), calls };
}

test("languageBreakdown computes byte shares and sorts by size", () => {
  const result = languageBreakdown({ TypeScript: 750, CSS: 250, Empty: 0 });
  assert.deepEqual(result, [
    { name: "TypeScript", bytes: 750, percentage: 75 },
    { name: "CSS", bytes: 250, percentage: 25 },
    { name: "Empty", bytes: 0, percentage: 0 },
  ]);
  assert.deepEqual(languageBreakdown({}), []);
});

test("tool discovery exposes all seven tools with validated schemas", async (t) => {
  const { client } = clientFor(() => ({ body: {} }));
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const response = await mcp.request("tools/list");
  const tools = Object.fromEntries(response.result.tools.map((tool) => [tool.name, tool]));
  const expected = [
    "ping",
    "get_repo_info",
    "get_commits",
    "list_issues",
    "list_pull_requests",
    "get_repo_languages",
    "get_repo_readme",
  ];
  for (const name of expected) {
    assert.ok(tools[name], `${name} must be discoverable`);
    assert.equal(tools[name].inputSchema.type, "object");
  }
  assert.deepEqual(tools.list_issues.inputSchema.properties.state.enum, ["open", "closed", "all"]);
  assert.equal(tools.get_commits.inputSchema.properties.limit.maximum, 50);
  assert.equal(tools.get_commits.inputSchema.properties.limit.default, 10);
});

test("get_repo_info returns formatted repository metadata", async (t) => {
  const { client } = clientFor(() => ({ body: repo }));
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const response = await mcp.request("tools/call", {
    name: "get_repo_info",
    arguments: { owner: "octocat", repo: "Hello-World" },
  });

  const text = response.result.content[0].text;
  assert.match(text, /Repository: octocat\/Hello-World/);
  assert.match(text, /Stars: 100/);
  assert.match(text, /Open issues: 3 \(GitHub's count includes pull requests\)/);
  assert.match(text, /License: MIT/);
  assert.match(text, /Visibility: public/);
  assert.notEqual(response.result.isError, true);
});

test("get_commits applies defaults and formats the first message line", async (t) => {
  const commits = [
    {
      sha: "abcdef1234567890",
      commit: { message: "Fix parser\n\nLong explanation", author: { name: "Ada", date: "2026-01-01T00:00:00Z" } },
      author: { login: "ada" },
      html_url: "https://github.com/o/r/commit/abcdef1234567890",
    },
  ];
  const { client, calls } = clientFor(() => ({ body: commits }));
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const response = await mcp.request("tools/call", {
    name: "get_commits",
    arguments: { owner: "o", repo: "r" },
  });

  assert.equal(calls[0].url.searchParams.get("per_page"), "10");
  assert.equal(calls[0].url.searchParams.get("sha"), null);
  assert.match(response.result.content[0].text, /Message: Fix parser/);
  assert.doesNotMatch(response.result.content[0].text, /Long explanation/);
});

test("list_issues tool filters pull requests and reports empty results", async (t) => {
  const { client } = clientFor(() => ({ body: [{ number: 1, title: "Only a PR", pull_request: {} }] }));
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const response = await mcp.request("tools/call", {
    name: "list_issues",
    arguments: { owner: "o", repo: "r", state: "closed" },
  });

  assert.equal(response.result.content[0].text, "No issues found.");
});

test("list_pull_requests and get_repo_languages return formatted data", async (t) => {
  const { client } = clientFor((url) => ({
    body: url.pathname.endsWith("/pulls")
      ? [
          {
            number: 4,
            title: "Improve docs",
            state: "open",
            user: { login: "grace" },
            head: { ref: "docs" },
            base: { ref: "main" },
            created_at: "2026-03-01T00:00:00Z",
            html_url: "https://github.com/o/r/pull/4",
          },
        ]
      : { TypeScript: 750, CSS: 250 },
  }));
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const pulls = await mcp.request("tools/call", {
    name: "list_pull_requests",
    arguments: { owner: "o", repo: "r", state: "open" },
  });
  assert.match(pulls.result.content[0].text, /Branches: docs -> main/);

  const languages = await mcp.request("tools/call", {
    name: "get_repo_languages",
    arguments: { owner: "o", repo: "r" },
  });
  assert.match(languages.result.content[0].text, /TypeScript, 750, 75\.00%/);
});

test("get_repo_readme decodes content and labels it as untrusted", async (t) => {
  const { client } = clientFor(() => ({
    body: {
      content: Buffer.from("# Hello\n", "utf8").toString("base64"),
      encoding: "base64",
      path: "README.md",
      html_url: "https://github.com/o/r/blob/main/README.md",
    },
  }));
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const response = await mcp.request("tools/call", {
    name: "get_repo_readme",
    arguments: { owner: "o", repo: "r" },
  });

  const text = response.result.content[0].text;
  assert.match(text, /Path: README\.md/);
  assert.match(text, /# Hello/);
  assert.match(text, /untrusted repository data/);
  assert.match(text, /--- BEGIN README ---/);
});

test("invalid tool arguments and API failures do not crash the server", async (t) => {
  const { client } = clientFor(() => ({ status: 404, body: { message: "Not Found" } }));
  const mcp = await createInMemoryClient(client);
  t.after(() => mcp.close());

  const invalid = await mcp.request("tools/call", {
    name: "get_repo_info",
    arguments: { owner: "../bad", repo: "r" },
  });
  assert.ok(invalid.error !== undefined || invalid.result.isError === true);

  const failed = await mcp.request("tools/call", {
    name: "get_repo_info",
    arguments: { owner: "o", repo: "missing" },
  });
  assert.equal(failed.result.isError, true);
  assert.match(failed.result.content[0].text, /not found/i);

  const ping = await mcp.request("tools/call", { name: "ping", arguments: {} });
  assert.equal(ping.result.content[0].text, "pong");
});
