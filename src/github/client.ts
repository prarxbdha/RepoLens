/** Read-only GitHub REST client: validation, caching, retries, bounds, and typed errors. */

import { loadConfig, type RepoLensConfig } from "../config/env.js";
import { BoundedResponseCache, authBucket, cacheKey } from "./cache.js";
import {
  GitHubError,
  describeError,
  isRateLimitStatus,
  isTransientStatus,
} from "./errors.js";
import { collectPages, hasNextPage, type Page } from "./pagination.js";
import type {
  DecodedFile,
  DecodedReadme,
  GitHubChangedFile,
  GitHubCodeSearchResult,
  GitHubCommit,
  GitHubCommitDetail,
  GitHubContentItem,
  GitHubContributor,
  GitHubIssue,
  GitHubLanguages,
  GitHubPullRequest,
  GitHubReadme,
  GitHubRepository,
  GitHubReview,
  GitHubTree,
} from "./types.js";
import { decodeGitHubContent } from "../utils/encoding.js";
import {
  validateBranch,
  validateFilter,
  validateLimit,
  validatePath,
  validatePullNumber,
  validateQuery,
  validateRef,
  validateRepoPart,
  validateSha,
  validateState,
} from "../utils/validation.js";

export const GITHUB_API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";
const USER_AGENT = "repolens/0.1.0";
const MAX_CODE_SEARCH_QUERY = 250;

export {
  GitHubError,
  describeError,
  redactToken,
  type GitHubErrorCause,
  type GitHubErrorKind,
  type GitHubRateLimitInfo,
} from "./errors.js";
export { validateBranch, validateLimit, validateRepoPart, validateState } from "../utils/validation.js";

export interface GitHubClientOptions {
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxReadmeBytes?: number;
  maxResponseBytes?: number;
  maxFileBytes?: number;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  maxConcurrentRequests?: number;
  config?: RepoLensConfig;
}

export interface RepositoryQuery {
  branch?: string;
  limit?: number;
}

export interface StateQuery {
  state: "open" | "closed" | "all";
  limit?: number;
}

export interface TreeQuery {
  ref?: string;
  recursive?: boolean;
}

export interface FileQuery {
  ref?: string;
  maxBytes?: number;
}

export interface CodeSearchQuery {
  query: string;
  language?: string;
  extension?: string;
  limit?: number;
}

export interface ContributorQuery {
  page?: number;
  perPage?: number;
}

interface RequestOptions {
  cache?: boolean;
  scope?: string;
}

interface RequestResult<T> {
  data: T;
  headers: Headers;
}

function numericHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseRateLimit(headers: Headers) {
  const reset = numericHeader(headers, "x-ratelimit-reset");
  return {
    limit: numericHeader(headers, "x-ratelimit-limit"),
    remaining: numericHeader(headers, "x-ratelimit-remaining"),
    reset: reset === null ? null : new Date(reset * 1000).toISOString(),
    retryAfterSeconds: numericHeader(headers, "retry-after"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Small, read-only client for the official GitHub REST API. */
export class GitHubClient {
  private readonly config: RepoLensConfig;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly cache: BoundedResponseCache;
  private readonly activeRequests: { count: number } = { count: 0 };
  private readonly waiters: Array<() => void> = [];

  constructor(options: GitHubClientOptions = {}) {
    const base = options.config ?? loadConfig();
    this.token = (options.token ?? base.token ?? "").trim() || undefined;
    this.config = {
      ...base,
      ...(options.token !== undefined ? { token: this.token } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.maxReadmeBytes !== undefined ? { maxReadmeBytes: options.maxReadmeBytes } : {}),
      ...(options.maxResponseBytes !== undefined
        ? { maxResponseBytes: options.maxResponseBytes }
        : {}),
      ...(options.maxFileBytes !== undefined ? { maxFileBytes: options.maxFileBytes } : {}),
      ...(options.cacheTtlMs !== undefined ? { cacheTtlMs: options.cacheTtlMs } : {}),
      ...(options.cacheMaxEntries !== undefined ? { cacheMaxEntries: options.cacheMaxEntries } : {}),
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      ...(options.retryDelayMs !== undefined ? { retryDelayMs: options.retryDelayMs } : {}),
      ...(options.maxConcurrentRequests !== undefined
        ? { maxConcurrentRequests: options.maxConcurrentRequests }
        : {}),
    };
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cache = new BoundedResponseCache(this.config.cacheTtlMs, this.config.cacheMaxEntries);

    if (!Number.isFinite(this.config.timeoutMs) || this.config.timeoutMs <= 0) {
      throw new GitHubError("validation", "timeoutMs must be a positive number.");
    }
    if (!Number.isInteger(this.config.maxReadmeBytes) || this.config.maxReadmeBytes <= 0) {
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

  private async acquireSlot(): Promise<() => void> {
    if (this.activeRequests.count < this.config.maxConcurrentRequests) {
      this.activeRequests.count += 1;
      return () => this.releaseSlot();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.activeRequests.count += 1;
    return () => this.releaseSlot();
  }

  private releaseSlot(): void {
    this.activeRequests.count -= 1;
    const next = this.waiters.shift();
    if (next !== undefined) next();
  }

  private async readBody(response: Response): Promise<string> {
    const limit = this.config.maxResponseBytes;
    if (response.body === null) {
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > limit) {
        throw new GitHubError("invalid-response", "GitHub response is too large.", response.status);
      }
      return text;
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel();
          throw new GitHubError("invalid-response", "GitHub response is too large.", response.status);
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  private async requestRaw<T>(
    path: string,
    query: Record<string, string | number | undefined> = {},
    options: RequestOptions = {},
  ): Promise<RequestResult<T>> {
    const url = this.buildUrl(path, query);
    const useCache = options.cache !== false && this.config.cacheTtlMs > 0 && this.config.cacheMaxEntries > 0;
    const key = cacheKey(options.scope ?? "rest", authBucket(this.token), path, query);
    if (useCache) {
      const cached = this.cache.get<T>(key);
      if (cached !== undefined) return { data: cached, headers: new Headers() };
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": USER_AGENT,
    };
    if (this.token !== undefined) headers.Authorization = `Bearer ${this.token}`;

    const attempts = this.config.maxRetries + 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      let release: (() => void) | undefined;
      try {
        release = await this.acquireSlot();
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
        const rateLimit = parseRateLimit(response.headers);
        const declaredLength = numericHeader(response.headers, "content-length");
        if (declaredLength !== null && declaredLength > this.config.maxResponseBytes) {
          throw new GitHubError(
            "invalid-response",
            "GitHub response is too large.",
            response.status,
            rateLimit,
          );
        }
        if (isRateLimitStatus(response.status, rateLimit.remaining)) {
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
          const error = new GitHubError("http", message, response.status, rateLimit);
          if (!isTransientStatus(response.status) || attempt === attempts - 1) throw error;
          lastError = error;
        } else {
          let body: unknown;
          try {
            body = JSON.parse(await this.readBody(response));
          } catch (cause) {
            throw new GitHubError(
              "invalid-response",
              "GitHub returned malformed JSON.",
              response.status,
              rateLimit,
              { cause },
            );
          }
          if (typeof body !== "object" || body === null) {
            throw new GitHubError(
              "invalid-response",
              "GitHub returned an unexpected JSON value.",
              response.status,
              rateLimit,
            );
          }
          if (useCache) this.cache.set(key, body);
          return { data: body as T, headers: response.headers };
        }
      } catch (error) {
        if (error instanceof GitHubError && !isTransientStatus(error.status ?? 0)) throw error;
        lastError = error;
        if (controller.signal.aborted) {
          lastError = new GitHubError(
            "timeout",
            `GitHub request timed out after ${this.config.timeoutMs}ms.`,
            undefined,
            undefined,
            { cause: error },
          );
        }
        if (attempt === attempts - 1) {
          if (lastError instanceof GitHubError) throw lastError;
          throw new GitHubError(
            "network",
            `GitHub request failed: ${describeError(lastError, this.token)}`,
            undefined,
            undefined,
            { cause: lastError },
          );
        }
      } finally {
        clearTimeout(timer);
        release?.();
      }
      await sleep(this.config.retryDelayMs * 2 ** attempt);
    }
    throw new GitHubError("network", `GitHub request failed: ${describeError(lastError, this.token)}`);
  }

  private async request<T>(
    path: string,
    query: Record<string, string | number | undefined> = {},
    options: RequestOptions = {},
  ): Promise<T> {
    return (await this.requestRaw<T>(path, query, options)).data;
  }

  private async requestPage<T>(
    path: string,
    query: Record<string, string | number | undefined>,
  ): Promise<Page<T>> {
    const result = await this.requestRaw<unknown>(path, query, { cache: false });
    return {
      data: Array.isArray(result.data) ? (result.data as T[]) : [],
      hasNextPage: hasNextPage(result.headers),
    };
  }

  /** Exposed for tests and diagnostics; contains no token material. */
  get cacheStats(): { hits: number; misses: number; size: number } {
    return { hits: this.cache.hits, misses: this.cache.misses, size: this.cache.size };
  }

  clearCache(): void {
    this.cache.clear();
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
    // GitHub's /issues endpoint includes pull requests. Fetch enough pages to
    // still return up to `limit` real issues after filtering them out.
    const perPage = Math.min(100, limit * 2);
    const collected = await collectPages<GitHubIssue>(
      async (page) =>
        this.requestPage<GitHubIssue>(`${this.repoPath(owner, repo)}/issues`, {
          state,
          per_page: perPage,
          page,
          sort: "created",
          direction: "desc",
        }),
      limit * 4,
      1,
      5,
    );
    return collected.items
      .filter((issue): issue is GitHubIssue =>
        typeof issue === "object" && issue !== null && !("pull_request" in issue),
      )
      .slice(0, limit);
  }

  async listPullRequests(owner: string, repo: string, query: StateQuery): Promise<GitHubPullRequest[]> {
    const limit = validateLimit(query.limit);
    const state = validateState(query.state);
    const collected = await collectPages<GitHubPullRequest>(
      async (page) =>
        this.requestPage<GitHubPullRequest>(`${this.repoPath(owner, repo)}/pulls`, {
          state,
          per_page: limit,
          page,
          sort: "created",
          direction: "desc",
        }),
      limit,
    );
    return collected.items;
  }

  async getLanguages(owner: string, repo: string): Promise<GitHubLanguages> {
    const languages = await this.request<GitHubLanguages>(`${this.repoPath(owner, repo)}/languages`);
    if (Array.isArray(languages) || Object.values(languages).some((bytes) => !Number.isFinite(bytes))) {
      throw new GitHubError("invalid-response", "GitHub returned an unexpected languages payload.");
    }
    return languages;
  }

  async getReadme(owner: string, repo: string, query: FileQuery = {}): Promise<DecodedReadme> {
    const raw = await this.request<GitHubReadme>(`${this.repoPath(owner, repo)}/readme`);
    if (
      typeof raw.content !== "string" ||
      typeof raw.encoding !== "string" ||
      typeof raw.path !== "string"
    ) {
      throw new GitHubError("invalid-response", "GitHub returned an incomplete README payload.");
    }
    const maxBytes = query.maxBytes ?? this.config.maxReadmeBytes;
    const decoded = decodeGitHubContent(raw.encoding, raw.content, maxBytes);
    return {
      content: decoded.text,
      path: raw.path,
      htmlUrl: typeof raw.html_url === "string" ? raw.html_url : "",
      bytes: typeof raw.size === "number" ? raw.size : decoded.originalBytes,
      truncated: decoded.truncated || (typeof raw.size === "number" && raw.size > maxBytes),
    };
  }

  async getGitTree(owner: string, repo: string, query: TreeQuery = {}): Promise<GitHubTree> {
    const ref = validateRef(query.ref, "ref") ?? "HEAD";
    const tree = await this.request<GitHubTree>(
      `${this.repoPath(owner, repo)}/git/trees/${encodeURIComponent(ref)}`,
      { recursive: query.recursive === false ? undefined : "1" },
    );
    if (!Array.isArray(tree?.tree) || typeof tree.truncated !== "boolean") {
      throw new GitHubError("invalid-response", "GitHub returned an unexpected tree payload.");
    }
    return tree;
  }

  async getContents(owner: string, repo: string, path: string, ref?: string): Promise<GitHubContentItem | GitHubContentItem[]> {
    const safePath = validatePath(path);
    const safeRef = validateRef(ref);
    const encodedPath = safePath.split("/").map(encodeURIComponent).join("/");
    const raw = await this.request<GitHubContentItem | GitHubContentItem[]>(
      `${this.repoPath(owner, repo)}/contents/${encodedPath}`,
      { ref: safeRef },
    );
    if (Array.isArray(raw)) {
      if (!raw.every((item) => typeof item?.path === "string" && typeof item?.type === "string")) {
        throw new GitHubError("invalid-response", "GitHub returned an unexpected contents listing.");
      }
      return raw;
    }
    if (typeof raw?.path !== "string" || typeof raw?.type !== "string") {
      throw new GitHubError("invalid-response", "GitHub returned an unexpected contents payload.");
    }
    return raw;
  }

  async getFile(owner: string, repo: string, path: string, query: FileQuery = {}): Promise<DecodedFile> {
    const safePath = validatePath(path);
    const maxBytes = query.maxBytes ?? this.config.maxFileBytes;
    const item = await this.getContents(owner, repo, safePath, query.ref);
    if (Array.isArray(item)) {
      throw new GitHubError("invalid-response", `Path ${safePath} is a directory, not a file.`);
    }
    if (item.type !== "file" && item.type !== "symlink") {
      throw new GitHubError("invalid-response", `Path ${safePath} is not a readable file (${item.type}).`);
    }
    const encoding = item.encoding ?? "none";
    const content = item.content ?? "";
    const decoded = decodeGitHubContent(encoding, content, maxBytes);
    const declaredSize =
      typeof item.size === "number" && item.size >= 0 ? item.size : decoded.originalBytes;
    const htmlUrl =
      item.html_url ??
      `${GITHUB_API_BASE.replace("api.", "")}/${owner}/${repo}/blob/${encodeURIComponent(query.ref ?? "HEAD")}/${safePath}`;
    return {
      path: item.path || safePath,
      size: declaredSize,
      content: decoded.text,
      encoding,
      sha: item.sha ?? "",
      htmlUrl,
      binary: decoded.binary,
      truncated: decoded.truncated || declaredSize > maxBytes,
    };
  }

  async searchCode(owner: string, repo: string, query: CodeSearchQuery): Promise<GitHubCodeSearchResult> {
    if (this.token === undefined) {
      throw new GitHubError(
        "validation",
        "GitHub code search requires GITHUB_TOKEN; unauthenticated code search is not supported.",
      );
    }
    const language = validateFilter(query.language, "language", /^[A-Za-z0-9+#.-]+$/);
    const extension = validateFilter(query.extension, "extension", /^\.?[A-Za-z0-9]+$/);
    const text = validateQuery(query.query);
    const limit = validateLimit(query.limit, 20, 30);
    const q = [
      `repo:${validateRepoPart("owner", owner)}/${validateRepoPart("repo", repo)}`,
      text,
      language === undefined ? "" : `language:${language}`,
      extension === undefined ? "" : `extension:${extension.replace(/^\./, "")}`,
    ]
      .filter((part) => part !== "")
      .join(" ");
    if (q.length > MAX_CODE_SEARCH_QUERY) {
      throw new GitHubError("validation", `Invalid query: search expression exceeds ${MAX_CODE_SEARCH_QUERY} characters.`);
    }
    const result = await this.request<GitHubCodeSearchResult>(
      "/search/code",
      { q, per_page: limit },
      { cache: false, scope: "search" },
    );
    if (
      !Number.isFinite(result?.total_count) ||
      typeof result.incomplete_results !== "boolean" ||
      !Array.isArray(result.items)
    ) {
      throw new GitHubError("invalid-response", "GitHub returned an unexpected code search payload.");
    }
    return result;
  }

  async listContributors(
    owner: string,
    repo: string,
    query: ContributorQuery = {},
  ): Promise<Page<GitHubContributor>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 30;
    if (!Number.isInteger(page) || page < 1 || page > 10_000) {
      throw new GitHubError("validation", "Invalid page: expected an integer from 1 to 10000.");
    }
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
      throw new GitHubError("validation", "Invalid perPage: expected an integer from 1 to 100.");
    }
    return this.requestPage<GitHubContributor>(`${this.repoPath(owner, repo)}/contributors`, {
      per_page: perPage,
      page,
      anon: "false",
    });
  }

  async getCommitDetail(owner: string, repo: string, sha: string): Promise<GitHubCommitDetail> {
    return this.request<GitHubCommitDetail>(
      `${this.repoPath(owner, repo)}/commits/${encodeURIComponent(validateSha(sha))}`,
    );
  }

  async getPullRequest(owner: string, repo: string, pullNumber: number): Promise<GitHubPullRequest> {
    return this.request<GitHubPullRequest>(
      `${this.repoPath(owner, repo)}/pulls/${validatePullNumber(pullNumber)}`,
    );
  }

  async getPullRequestFiles(
    owner: string,
    repo: string,
    pullNumber: number,
    limit = 100,
  ): Promise<Page<GitHubChangedFile>> {
    const bounded = validateLimit(limit, 100, 100, "limit");
    return this.requestPage<GitHubChangedFile>(
      `${this.repoPath(owner, repo)}/pulls/${validatePullNumber(pullNumber)}/files`,
      { per_page: bounded },
    );
  }

  async getPullRequestReviews(
    owner: string,
    repo: string,
    pullNumber: number,
    limit = 30,
  ): Promise<Page<GitHubReview>> {
    const bounded = validateLimit(limit, 30, 100, "limit");
    return this.requestPage<GitHubReview>(
      `${this.repoPath(owner, repo)}/pulls/${validatePullNumber(pullNumber)}/reviews`,
      { per_page: bounded },
    );
  }
}
