import assert from "node:assert/strict";
import { test } from "node:test";
import { BoundedResponseCache, authBucket, cacheKey } from "../dist/github/cache.js";
import { GitHubClient, GitHubError } from "../dist/github/client.js";
import { collectPages, parseLinkHeader } from "../dist/github/pagination.js";
import { createMockFetch } from "./helpers.js";

const repo = {
  name: "r",
  full_name: "o/r",
  description: null,
  owner: { login: "o" },
  language: null,
  stargazers_count: 0,
  forks_count: 0,
  open_issues_count: 0,
  default_branch: "main",
  created_at: "",
  updated_at: "",
  html_url: "https://github.com/o/r",
  license: null,
  visibility: "public",
  private: false,
};

function clientFor(handler, options = {}) {
  const { fetchImpl, calls } = createMockFetch(handler);
  return {
    calls,
    client: new GitHubClient({ fetchImpl, cacheTtlMs: 0, maxRetries: 0, ...options }),
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("bounded cache expires entries and evicts the least recently used", async () => {
  const short = new BoundedResponseCache(10, 4);
  short.set("key", { value: 1 });
  assert.deepEqual(short.get("key"), { value: 1 });
  await wait(20);
  assert.equal(short.get("key"), undefined);
  assert.equal(short.size, 0);

  const bounded = new BoundedResponseCache(1_000, 2);
  bounded.set("a", 1);
  bounded.set("b", 2);
  assert.equal(bounded.get("a"), 1);
  bounded.set("c", 3);
  assert.equal(bounded.get("b"), undefined);
  assert.equal(bounded.get("a"), 1);
  assert.equal(bounded.get("c"), 3);
});

test("cache keys separate authenticated access and never contain the token", () => {
  const query = { ref: "main", per_page: 5 };
  const anonymous = cacheKey("rest", authBucket(undefined), "/repos/o/r", query);
  const authenticated = cacheKey("rest", authBucket("super-secret-token"), "/repos/o/r", query);
  assert.notEqual(anonymous, authenticated);
  assert.doesNotMatch(`${anonymous}${authenticated}`, /super-secret-token/);
  assert.equal(
    cacheKey("rest", "anon", "/repos/o/r", { b: 2, a: 1 }),
    cacheKey("rest", "anon", "/repos/o/r", { a: 1, b: 2 }),
  );
});

test("client reuses successful responses until the cache is cleared", async () => {
  const { client, calls } = clientFor(() => ({ body: repo }), {
    cacheTtlMs: 1_000,
    cacheMaxEntries: 10,
  });
  await client.getRepository("o", "r");
  await client.getRepository("o", "r");
  assert.equal(calls.length, 1);
  assert.equal(client.cacheStats.hits, 1);
  client.clearCache();
  await client.getRepository("o", "r");
  assert.equal(calls.length, 2);
});

test("rate-limit responses are not retried and preserve Retry-After guidance", async () => {
  const { client, calls } = clientFor(
    () => ({
      status: 429,
      headers: {
        "x-ratelimit-limit": "30",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1767225600",
        "retry-after": "12",
      },
      body: {},
    }),
    { maxRetries: 3, retryDelayMs: 0 },
  );
  await assert.rejects(
    () => client.getRepository("o", "r"),
    (error) => {
      assert.ok(error instanceof GitHubError);
      assert.equal(error.kind, "rate-limit");
      assert.equal(error.rateLimit.retryAfterSeconds, 12);
      assert.match(error.message, /Retry after 12s/);
      assert.match(error.message, /Resets at/);
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test("transient server errors are retried but permanent client errors are not", async () => {
  let attempts = 0;
  const transient = clientFor(
    () => {
      attempts += 1;
      return attempts < 3 ? { status: 503, body: {} } : { body: repo };
    },
    { maxRetries: 2, retryDelayMs: 0 },
  );
  const result = await transient.client.getRepository("o", "r");
  assert.equal(result.full_name, "o/r");
  assert.equal(attempts, 3);

  const permanent = clientFor(() => ({ status: 404, body: {} }), {
    maxRetries: 2,
    retryDelayMs: 0,
  });
  await assert.rejects(
    () => permanent.client.getRepository("o", "missing"),
    (error) => error.kind === "http" && error.status === 404,
  );
  assert.equal(permanent.calls.length, 1);
});

test("response size limits apply to streamed bodies and declared lengths", async () => {
  const streamed = clientFor(() => ({ body: "x".repeat(5_000) }), { maxResponseBytes: 1_000 });
  await assert.rejects(
    () => streamed.client.getRepository("o", "r"),
    (error) => error.kind === "invalid-response",
  );

  const declared = clientFor(
    () => ({
      body: repo,
      headers: { "content-length": "999999" },
    }),
    { maxResponseBytes: 1_000 },
  );
  await assert.rejects(
    () => declared.client.getRepository("o", "r"),
    (error) => error.kind === "invalid-response",
  );
});

test("pagination helpers respect bounds and parse Link headers", async () => {
  const parsed = parseLinkHeader(
    '<https://api.github.com/repos/o/r?page=2>; rel="next", <https://api.github.com/repos/o/r?page=5>; rel="last"',
  );
  assert.match(parsed.next, /page=2/);
  assert.match(parsed.last, /page=5/);

  const collected = await collectPages(
    async (page) => ({ data: page === 1 ? [1, 2] : [3, 4], hasNextPage: page === 1 }),
    3,
  );
  assert.deepEqual(collected.items, [1, 2, 3]);
  assert.equal(collected.pagesFetched, 2);
  assert.equal(collected.truncated, true);
});

test("list_pull_requests follows pagination while respecting the limit", async () => {
  const pull = (number) => ({
    number,
    title: `PR ${number}`,
    state: "open",
    user: { login: "ada" },
    head: { ref: "feature" },
    base: { ref: "main" },
    created_at: "2026-01-01T00:00:00Z",
    html_url: `https://github.com/o/r/pull/${number}`,
  });
  const { client, calls } = clientFor((url) => {
    if (url.searchParams.get("page") === "2") return { body: [pull(3), pull(4)] };
    return {
      headers: { link: '<https://api.github.com/repos/o/r/pulls?page=2>; rel="next"' },
      body: [pull(1), pull(2)],
    };
  });
  const pulls = await client.listPullRequests("o", "r", { state: "open", limit: 3 });
  assert.deepEqual(pulls.map((item) => item.number), [1, 2, 3]);
  assert.equal(calls.length, 2);
});

test("concurrent requests are bounded by the configured limit", async () => {
  let active = 0;
  let peak = 0;
  const { client } = clientFor(
    async () => {
      active += 1;
      peak = Math.max(peak, active);
      await wait(5);
      active -= 1;
      return { body: repo };
    },
    { maxConcurrentRequests: 2 },
  );
  await Promise.all(Array.from({ length: 6 }, () => client.getRepository("o", "r")));
  assert.ok(peak <= 2, `peak concurrency was ${peak}`);
  assert.equal(peak, 2);
});
