import type {
  DecodedReadme,
  GitHubCommit,
  GitHubIssue,
  GitHubLanguages,
  GitHubPullRequest,
  GitHubReadme,
  GitHubRepository,
} from "./types.js";

export const GITHUB_API_BASE = "https://api.github.com";

const API_VERSION = "2022-11-28";
const USER_AGENT = "repolens/0.1.0";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_README_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const MAX_TOOL_LIMIT = 50;

export type GitHubErrorKind =
  | "validation"
  | "http"
  | "rate-limit"
  | "network"
  | "timeout"
  | "invalid-response";

export interface GitHubRateLimitInfo {
  limit: number | null;
  remaining: number | null;
  reset: string | null;
  retryAfterSeconds: number | null;
}

export interface GitHubErrorCause {
  cause?: unknown;
}

export class GitHubError extends Error {
  readonly kind: GitHubErrorKind;
  readonly status?: number;
  readonly rateLimit?: GitHubRateLimitInfo;

  constructor(
    kind: GitHubErrorKind,
    message: string,
    status?: number,
    rateLimit?: GitHubRateLimitInfo,
    options: GitHubErrorCause = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GitHubError";
    this.kind = kind;
    this.status = status;
    this.rateLimit = rateLimit;
  }
}

export function redactToken(text: string, token?: string): string {
  const secret = (token ?? process.env.GITHUB_TOKEN ?? "").trim();
  return secret.length > 0 ? text.split(secret).join("[REDACTED]") : text;
}

export function describeError(error: unknown, token?: string): string {
  if (error instanceof GitHubError) return redactToken(error.message, token);
  if (error instanceof Error) return redactToken(error.message, token);
  return redactToken(String(error), token);
}

export interface GitHubClientOptions {
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxReadmeBytes?: number;
}

export interface RepositoryQuery {
  branch?: string;
  limit?: number;
}

export interface StateQuery {
  state: "open" | "closed" | "all";
  limit?: number;
}

function numericHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseRateLimit(headers: Headers): GitHubRateLimitInfo {
  const reset = numericHeader(headers, "x-ratelimit-reset");
  return {
    limit: numericHeader(headers, "x-ratelimit-limit"),
    remaining: numericHeader(headers, "x-ratelimit-remaining"),
    reset: reset === null ? null : new Date(reset * 1000).toISOString(),
    retryAfterSeconds: numericHeader(headers, "retry-after"),
  };
}

export function validateRepoPart(kind: "owner" | "repo", value: string): string {
  const trimmed = value.trim();
  if (!NAME_PATTERN.test(trimmed) || trimmed === "." || trimmed === "..") {
    throw new GitHubError(
      "validation",
      `Invalid ${kind}: expected 1-100 characters using letters, digits, '.', '_' or '-'.`,
    );
  }
  return trimmed;
}

export function validateBranch(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const branch = value.trim();
  if (branch.length === 0 || branch.length > 255 || /[\u0000-\u001F\u007F]/.test(branch)) {
    throw new GitHubError("validation", "Invalid branch: expected 1-255 printable characters.");
  }
  return branch;
}

export function validateLimit(value: number | undefined): number {
  if (value === undefined) return 10;
  if (!Number.isInteger(value) || value < 1 || value > MAX_TOOL_LIMIT) {
    throw new GitHubError("validation", `Invalid limit: expected an integer from 1 to ${MAX_TOOL_LIMIT}.`);
  }
  return value;
}

export function validateState(value: string): "open" | "closed" | "all" {
  if (value === "open" || value === "closed" || value === "all") return value;
  throw new GitHubError("validation", "Invalid state: expected 'open', 'closed' or 'all'.");
}

/** Small, read-only client for the official GitHub REST API. */
export class GitHubClient {
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxReadmeBytes: number;

  constructor(options: GitHubClientOptions = {}) {
    const token = (options.token ?? process.env.GITHUB_TOKEN ?? "").trim();
    this.token = token.length > 0 ? token : undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxReadmeBytes = options.maxReadmeBytes ?? DEFAULT_MAX_README_BYTES;

    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new GitHubError("validation", "timeoutMs must be a positive number.");
    }
    if (!Number.isInteger(this.maxReadmeBytes) || this.maxReadmeBytes <= 0) {
      throw new GitHubError("validation", "maxReadmeBytes must be a positive integer.");
    }
  }

  private repoPath(owner: string, repo: string): string {
    const safeOwner = encodeURIComponent(validateRepoPart("owner", owner));
    const safeRepo = encodeURIComponent(validateRepoPart("repo", repo));
    return `/repos/${safeOwner}/${safeRepo}`;
  }

  private buildUrl(path: string, query: Record<string, string | number | undefined>): URL {
    if (!path.startsWith("/") || path.includes("..") || path.includes("//")) {
      throw new GitHubError("validation", "Invalid GitHub API path.");
    }
    const url = new URL(path, GITHUB_API_BASE);
    if (url.origin !== GITHUB_API_BASE) {
      throw new GitHubError("validation", "Requests are restricted to the official GitHub API.");
    }
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }

  private async request<T>(
    path: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    const url = this.buildUrl(path, query);
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": USER_AGENT,
    };
    if (this.token !== undefined) headers.Authorization = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      const rateLimit = parseRateLimit(response.headers);
      const declaredLength = numericHeader(response.headers, "content-length");

      if (declaredLength !== null && declaredLength > MAX_RESPONSE_BYTES) {
        throw new GitHubError("invalid-response", "GitHub response is too large.", response.status, rateLimit);
      }

      if (response.status === 429 || (response.status === 403 && rateLimit.remaining === 0)) {
        const retry = rateLimit.retryAfterSeconds === null ? "" : ` Retry after ${rateLimit.retryAfterSeconds}s.`;
        const reset = rateLimit.reset === null ? "" : ` Resets at ${rateLimit.reset}.`;
        throw new GitHubError(
          "rate-limit",
          `GitHub API rate limit exceeded.${retry}${reset}`,
          response.status,
          rateLimit,
        );
      }

      if (!response.ok) {
        let message = `GitHub API request failed with HTTP ${response.status}.`;
        if (response.status === 401) message = "GitHub authentication failed; check GITHUB_TOKEN.";
        else if (response.status === 403) message = "GitHub access is forbidden for this resource.";
        else if (response.status === 404) message = "Repository or resource not found, or access is not permitted.";
        throw new GitHubError("http", message, response.status, rateLimit);
      }

      let body: unknown;
      try {
        body = JSON.parse(await response.text());
      } catch (cause) {
        throw new GitHubError("invalid-response", "GitHub returned malformed JSON.", response.status, rateLimit, { cause });
      }
      if (typeof body !== "object" || body === null) {
        throw new GitHubError("invalid-response", "GitHub returned an unexpected JSON value.", response.status, rateLimit);
      }
      return body as T;
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      if (controller.signal.aborted) {
        throw new GitHubError("timeout", `GitHub request timed out after ${this.timeoutMs}ms.`, undefined, undefined, { cause: error });
      }
      throw new GitHubError("network", `GitHub request failed: ${describeError(error, this.token)}`, undefined, undefined, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    return this.request<GitHubRepository>(this.repoPath(owner, repo));
  }

  async getCommits(owner: string, repo: string, query: RepositoryQuery = {}): Promise<GitHubCommit[]> {
    const branch = validateBranch(query.branch);
    const limit = validateLimit(query.limit);
    const commits = await this.request<GitHubCommit[]>(`${this.repoPath(owner, repo)}/commits`, {
      per_page: limit,
      ...(branch === undefined ? {} : { sha: branch }),
    });
    if (!Array.isArray(commits)) {
      throw new GitHubError("invalid-response", "GitHub returned an unexpected commits payload.");
    }
    return commits.slice(0, limit);
  }

  async listIssues(owner: string, repo: string, query: StateQuery): Promise<GitHubIssue[]> {
    const limit = validateLimit(query.limit);
    const state = validateState(query.state);
    // GitHub's /issues endpoint includes pull requests. Fetch enough items to
    // still return up to `limit` real issues after filtering them out.
    const perPage = Math.min(100, limit * 2);
    const issues = await this.request<GitHubIssue[]>(`${this.repoPath(owner, repo)}/issues`, {
      state,
      per_page: perPage,
      sort: "created",
      direction: "desc",
    });
    if (!Array.isArray(issues)) {
      throw new GitHubError("invalid-response", "GitHub returned an unexpected issues payload.");
    }
    return issues
      .filter((issue): issue is GitHubIssue =>
        typeof issue === "object" && issue !== null && !("pull_request" in issue),
      )
      .slice(0, limit);
  }

  async listPullRequests(owner: string, repo: string, query: StateQuery): Promise<GitHubPullRequest[]> {
    const limit = validateLimit(query.limit);
    const state = validateState(query.state);
    const pulls = await this.request<GitHubPullRequest[]>(`${this.repoPath(owner, repo)}/pulls`, {
      state,
      per_page: limit,
      sort: "created",
      direction: "desc",
    });
    if (!Array.isArray(pulls)) {
      throw new GitHubError("invalid-response", "GitHub returned an unexpected pull requests payload.");
    }
    return pulls.slice(0, limit);
  }

  async getLanguages(owner: string, repo: string): Promise<GitHubLanguages> {
    const languages = await this.request<GitHubLanguages>(`${this.repoPath(owner, repo)}/languages`);
    if (Array.isArray(languages) || Object.values(languages).some((bytes) => !Number.isFinite(bytes))) {
      throw new GitHubError("invalid-response", "GitHub returned an unexpected languages payload.");
    }
    return languages;
  }

  async getReadme(owner: string, repo: string): Promise<DecodedReadme> {
    const raw = await this.request<GitHubReadme>(`${this.repoPath(owner, repo)}/readme`);
    if (
      typeof raw.content !== "string" ||
      typeof raw.encoding !== "string" ||
      typeof raw.path !== "string"
    ) {
      throw new GitHubError("invalid-response", "GitHub returned an incomplete README payload.");
    }
    if (raw.encoding.toLowerCase() !== "base64") {
      throw new GitHubError("invalid-response", `Unsupported README encoding: ${raw.encoding}.`);
    }
    const encoded = raw.content.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw new GitHubError("invalid-response", "GitHub returned an invalid base64 README payload.");
    }
    const bytes = Buffer.from(encoded, "base64");
    const truncated = bytes.length > this.maxReadmeBytes;
    return {
      content: (truncated ? bytes.subarray(0, this.maxReadmeBytes) : bytes).toString("utf8"),
      path: raw.path,
      htmlUrl: typeof raw.html_url === "string" ? raw.html_url : "",
      bytes: bytes.length,
      truncated,
    };
  }
}
