/** Environment-driven runtime configuration with bounded, safe defaults. */

export interface RepoLensConfig {
  token?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  maxFileBytes: number;
  maxReadmeBytes: number;
  maxTreeEntries: number;
  maxPatchChars: number;
  maxConcurrentRequests: number;
  maxRetries: number;
  retryDelayMs: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
}

function boundedInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RepoLensConfig {
  const token = (env.GITHUB_TOKEN ?? "").trim();
  return {
    ...(token.length > 0 ? { token } : {}),
    timeoutMs: boundedInt(env, "REPOLENS_TIMEOUT_MS", 10_000, 100, 120_000),
    maxResponseBytes: boundedInt(
      env,
      "REPOLENS_MAX_RESPONSE_BYTES",
      5 * 1024 * 1024,
      64 * 1024,
      32 * 1024 * 1024,
    ),
    maxFileBytes: boundedInt(env, "REPOLENS_MAX_FILE_BYTES", 512 * 1024, 1024, 8 * 1024 * 1024),
    maxReadmeBytes: boundedInt(env, "REPOLENS_MAX_README_BYTES", 64 * 1024, 1024, 2 * 1024 * 1024),
    maxTreeEntries: boundedInt(env, "REPOLENS_MAX_TREE_ENTRIES", 500, 10, 5_000),
    maxPatchChars: boundedInt(env, "REPOLENS_MAX_PATCH_CHARS", 4_000, 200, 100_000),
    maxConcurrentRequests: boundedInt(env, "REPOLENS_MAX_CONCURRENCY", 4, 1, 16),
    maxRetries: boundedInt(env, "REPOLENS_MAX_RETRIES", 2, 0, 5),
    retryDelayMs: boundedInt(env, "REPOLENS_RETRY_DELAY_MS", 250, 0, 5_000),
    cacheTtlMs: boundedInt(env, "REPOLENS_CACHE_TTL_MS", 60_000, 0, 3_600_000),
    cacheMaxEntries: boundedInt(env, "REPOLENS_CACHE_MAX_ENTRIES", 200, 0, 5_000),
  };
}
