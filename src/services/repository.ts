/** Repository exploration services built on the shared GitHub client. */

import { GitHubClient } from "../github/client.js";
import { GitHubError } from "../github/errors.js";
import type { GitHubTreeEntry } from "../github/types.js";
import { truncateArray } from "../utils/truncation.js";
import { validateLimit, validatePath, validatePositiveInteger, validateRef } from "../utils/validation.js";

export interface TreeEntryView {
  path: string;
  type: GitHubTreeEntry["type"];
  size: number | null;
  depth: number;
}

export interface TreeOverview {
  owner: string;
  repo: string;
  ref: string;
  requestedPath: string | null;
  treeSha: string;
  entries: TreeEntryView[];
  totalReturned: number;
  directoryCount: number;
  fileCount: number;
  truncated: boolean;
  sourceTruncated: boolean;
}

export interface TreeOverviewOptions {
  ref?: string;
  path?: string;
  maxDepth?: number;
  limit?: number;
}

export async function resolveRef(
  client: GitHubClient,
  owner: string,
  repo: string,
  ref?: string,
): Promise<string> {
  const explicit = validateRef(ref, "ref");
  if (explicit !== undefined) return explicit;
  const metadata = await client.getRepository(owner, repo);
  return metadata.default_branch;
}

export async function getTreeOverview(
  client: GitHubClient,
  owner: string,
  repo: string,
  options: TreeOverviewOptions = {},
): Promise<TreeOverview> {
  const maxDepth = validatePositiveInteger(options.maxDepth, "max_depth", 3, 1, 10);
  const limit = validateLimit(options.limit, 100, 500);
  const requestedPath = options.path === undefined ? null : validatePath(options.path, "path");
  const ref = await resolveRef(client, owner, repo, options.ref);
  const tree = await client.getGitTree(owner, repo, { ref, recursive: true });

  let basePath = "";
  if (requestedPath !== null) {
    const item = await client.getContents(owner, repo, requestedPath, ref);
    if (!Array.isArray(item) && item.type !== "tree" && item.type !== "file") {
      throw new GitHubError("invalid-response", `Unsupported path type: ${item.type}.`);
    }
    basePath = requestedPath;
  }

  const matches = tree.tree
    .filter((entry) =>
      basePath === ""
        ? entry.path.split("/").length <= maxDepth
        : entry.path === basePath || entry.path.startsWith(`${basePath}/`),
    )
    .map((entry) => ({
      path: entry.path,
      type: entry.type,
      size: entry.type === "blob" && typeof entry.size === "number" ? entry.size : null,
      depth:
        basePath === ""
          ? entry.path.split("/").length
          : entry.path === basePath
            ? 0
            : entry.path.slice(basePath.length + 1).split("/").length,
    }))
    .filter((entry) => (basePath === "" ? true : entry.path === basePath || entry.depth <= maxDepth))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const bounded = truncateArray(matches, limit);
  return {
    owner,
    repo,
    ref,
    requestedPath,
    treeSha: tree.sha,
    entries: bounded.items,
    totalReturned: bounded.items.length,
    directoryCount: bounded.items.filter((entry) => entry.type === "tree").length,
    fileCount: bounded.items.filter((entry) => entry.type === "blob").length,
    truncated: bounded.truncated || tree.truncated,
    sourceTruncated: tree.truncated,
  };
}

/** Deterministic manifest discovery from a single recursive tree response. */
export async function findManifestPaths(
  client: GitHubClient,
  owner: string,
  repo: string,
  ref?: string,
  limit = 60,
): Promise<{ paths: string[]; sourceTruncated: boolean }> {
  const resolved = await resolveRef(client, owner, repo, ref);
  const tree = await client.getGitTree(owner, repo, { ref: resolved, recursive: true });
  const names = new Set([
    "package.json",
    "cargo.toml",
    "requirements.txt",
    "pyproject.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "go.mod",
    "composer.json",
  ]);
  const ignorePrefixes = ["node_modules/", "vendor/", "dist/", "build/", "target/", ".git/"];
  const candidates = tree.tree
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.path)
    .filter(
      (path) =>
        !ignorePrefixes.some((prefix) => path.startsWith(prefix)) &&
        path.split("/").length <= 6 &&
        names.has(path.split("/").pop()?.toLowerCase() ?? ""),
    )
    .sort(
      (left, right) =>
        left.split("/").length - right.split("/").length ||
        (left < right ? -1 : left > right ? 1 : 0),
    );
  return { paths: truncateArray(candidates, limit).items, sourceTruncated: tree.truncated };
}
