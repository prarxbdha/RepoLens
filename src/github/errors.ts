/** Typed GitHub failures and token-safe error formatting. */

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
  const secrets = [token, process.env.GITHUB_TOKEN]
    .map((value) => (value ?? "").trim())
    .filter((value) => value.length > 0);
  let result = text;
  for (const secret of new Set(secrets)) {
    result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

export function describeError(error: unknown, token?: string): string {
  const message =
    error instanceof GitHubError || error instanceof Error ? error.message : String(error);
  return redactToken(message, token);
}

export function isRateLimitStatus(status: number, remaining: number | null): boolean {
  return status === 429 || (status === 403 && remaining === 0);
}

export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status >= 500;
}
