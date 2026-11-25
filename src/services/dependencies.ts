/** Dependency detection across multiple manifests and ecosystems. */

import { GitHubClient, describeError } from "../github/client.js";
import { GitHubError } from "../github/errors.js";
import {
  frameworkIndicators,
  parseManifest,
  type DeclaredDependency,
  type FrameworkIndicator,
  type ParsedManifest,
} from "./dependencyParser.js";
import { findManifestPaths, resolveRef } from "./repository.js";

const MAX_MANIFEST_BYTES = 256 * 1024;
const ROOT_MANIFESTS = [
  "package.json",
  "Cargo.toml",
  "requirements.txt",
  "pyproject.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "go.mod",
  "composer.json",
];

export interface DependencyView extends ParsedManifest {
  truncated: boolean;
}

export interface DependencyReport {
  owner: string;
  repo: string;
  ref: string;
  ecosystems: string[];
  packageManagers: string[];
  manifests: DependencyView[];
  production: Array<DeclaredDependency & { source: string }>;
  development: Array<DeclaredDependency & { source: string }>;
  frameworkIndicators: FrameworkIndicator[];
  errors: string[];
  truncated: boolean;
}

async function probeRootManifests(
  client: GitHubClient,
  owner: string,
  repo: string,
  ref: string,
): Promise<string[]> {
  const results = await Promise.all(
    ROOT_MANIFESTS.map(async (path) => {
      try {
        const item = await client.getFile(owner, repo, path, { ref, maxBytes: MAX_MANIFEST_BYTES });
        return item.binary ? null : path;
      } catch (error) {
        if (error instanceof GitHubError && (error.status === 404 || error.kind === "validation")) return null;
        throw error;
      }
    }),
  );
  return results.filter((path): path is string => path !== null);
}

export async function getRepositoryDependencies(
  client: GitHubClient,
  owner: string,
  repo: string,
  ref?: string,
): Promise<DependencyReport> {
  const resolved = await resolveRef(client, owner, repo, ref);
  const discovered = await findManifestPaths(client, owner, repo, resolved);
  const paths =
    discovered.paths.length > 0
      ? discovered.paths
      : discovered.sourceTruncated
        ? await probeRootManifests(client, owner, repo, resolved)
        : [];

  const errors: string[] = [];
  const manifests: DependencyView[] = [];
  let truncated = discovered.sourceTruncated;

  await Promise.all(
    paths.map(async (path) => {
      try {
        const file = await client.getFile(owner, repo, path, {
          ref: resolved,
          maxBytes: MAX_MANIFEST_BYTES,
        });
        if (file.binary) {
          errors.push(`${path}: binary manifest skipped`);
          return;
        }
        truncated ||= file.truncated;
        const parsed = parseManifest(path, file.content);
        manifests.push({ ...parsed, truncated: file.truncated });
      } catch (error) {
        errors.push(`${path}: ${describeError(error)}`);
      }
    }),
  );

  manifests.sort((left, right) => left.path.localeCompare(right.path));
  const withSource = (items: DeclaredDependency[], source: string) =>
    items.map((item) => ({ ...item, source }));
  return {
    owner,
    repo,
    ref: resolved,
    ecosystems: [...new Set(manifests.map((manifest) => manifest.ecosystem))],
    packageManagers: [...new Set(manifests.map((manifest) => manifest.packageManager))],
    manifests,
    production: manifests.flatMap((manifest) => withSource(manifest.production, manifest.path)),
    development: manifests.flatMap((manifest) => withSource(manifest.development, manifest.path)),
    frameworkIndicators: frameworkIndicators(manifests),
    errors,
    truncated,
  };
}
