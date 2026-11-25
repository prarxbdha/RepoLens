/** Composite, file-based repository intelligence. No code is executed or interpreted. */

import { GitHubClient, describeError } from "../github/client.js";
import type {
  GitHubCommit,
  GitHubContributor,
  GitHubPullRequest,
} from "../github/types.js";
import { getRepositoryDependencies, type DependencyReport } from "./dependencies.js";
import { languageBreakdown, type LanguageShare } from "./languages.js";
import { getTreeOverview, resolveRef, type TreeEntryView } from "./repository.js";

export interface AnalysisOptions {
  ref?: string;
  includeActivity?: boolean;
  includeDependencies?: boolean;
}

export interface AnalysisError {
  section: string;
  message: string;
}

export interface DependencySummary {
  available: boolean;
  ecosystems: string[];
  packageManagers: string[];
  manifestPaths: string[];
  productionCount: number;
  developmentCount: number;
  frameworkIndicators: DependencyReport["frameworkIndicators"];
  errors: string[];
  truncated: boolean;
}

export interface ActivitySummary {
  available: boolean;
  recentCommits: Array<{ sha: string; message: string; date: string | null; url: string }>;
  contributors: Array<{ login: string; contributions: number; profileUrl: string }>;
  recentPullRequests: Array<{ number: number; title: string; state: string; url: string }>;
  pushedAt: string | null;
  errors: string[];
}

export interface HeuristicIndicators {
  paths: string[];
  basis: "deterministic file-path heuristics";
  inferred: true;
}

export interface RepositoryAnalysis {
  generatedAt: string;
  identity: {
    fullName: string;
    description: string | null;
    url: string;
    defaultBranch: string;
    resolvedRef: string;
    visibility: string;
    license: { name: string | null; spdxId: string | null } | null;
    createdAt: string;
    updatedAt: string;
  };
  languages: {
    primary: string | null;
    distribution: LanguageShare[];
  };
  structure: {
    entries: TreeEntryView[];
    directoryCount: number;
    fileCount: number;
    sourceTruncated: boolean;
    truncated: boolean;
  };
  dependencies: DependencySummary;
  technologies: {
    frameworkIndicators: DependencyReport["frameworkIndicators"];
    configIndicators: HeuristicIndicators;
  };
  readme: {
    available: boolean;
    path: string | null;
    truncated: boolean;
  };
  activity: ActivitySummary;
  entryPoints: HeuristicIndicators;
  testing: HeuristicIndicators;
  ci: HeuristicIndicators;
  documentation: HeuristicIndicators;
  inferredNote: string;
  errors: AnalysisError[];
  incomplete: boolean;
}

interface SectionResult<T> {
  value?: T;
  error?: AnalysisError;
}

async function section<T>(label: string, task: Promise<T>): Promise<SectionResult<T>> {
  try {
    return { value: await task };
  } catch (error) {
    return { error: { section: label, message: describeError(error) } };
  }
}

function firstLine(message: string): string {
  return message.split("\n", 1)[0]?.trim() ?? "";
}

const ENTRY_POINT_PATTERNS = [
  /(^|\/)index\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /(^|\/)main\.(ts|tsx|js|jsx|py|go|rs|java|cs)$/i,
  /(^|\/)app\.(ts|tsx|js|jsx|py)$/i,
  /(^|\/)server\.(ts|js|py)$/i,
  /(^|\/)cmd\/main\.go$/i,
  /(^|\/)manage\.py$/i,
  /(^|\/)program\.cs$/i,
  /(^|\/)src\/lib\.rs$/i,
];

const TEST_PATTERNS = [
  /(^|\/)(test|tests|spec|specs|__tests__)(\/|$)/i,
  /\.(test|spec)\.[a-z0-9]+$/i,
  /(^|\/)(pytest\.ini|tox\.ini|jest\.config\.[a-z]+|vitest\.config\.[a-z]+|playwright\.config\.[a-z]+)$/i,
];

const CI_PATTERNS = [
  /^\.github\/workflows\//i,
  /(^|\/)\.gitlab-ci\.ya?ml$/i,
  /(^|\/)(jenkinsfile|azure-pipelines\.ya?ml)$/i,
  /^\.circleci\//i,
];

const DOC_PATTERNS = [
  /^readme(\.[a-z0-9]+)?$/i,
  /(^|\/)docs?(\/|$)/i,
  /(^|\/)(contributing|changelog|architecture|code_of_conduct)(\.[a-z0-9]+)?$/i,
];

const CONFIG_NAMES = [
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "next.config.mjs",
  "tailwind.config.js",
  "tailwind.config.ts",
  "eslint.config.js",
  ".eslintrc.json",
  "dockerfile",
  "makefile",
  "webpack.config.js",
  "babel.config.js",
];

function matchedPaths(paths: string[], patterns: RegExp[], limit: number): string[] {
  return paths.filter((path) => patterns.some((pattern) => pattern.test(path))).slice(0, limit);
}

function configIndicators(paths: string[], limit: number): string[] {
  return paths
    .filter((path) => {
      const base = path.split("/").pop()?.toLowerCase() ?? "";
      return CONFIG_NAMES.includes(base) || path.startsWith(".github/workflows/");
    })
    .slice(0, limit);
}

function dependencySummary(report: DependencyReport): DependencySummary {
  return {
    available: true,
    ecosystems: report.ecosystems,
    packageManagers: report.packageManagers,
    manifestPaths: report.manifests.map((manifest) => manifest.path),
    productionCount: report.production.length,
    developmentCount: report.development.length,
    frameworkIndicators: report.frameworkIndicators,
    errors: report.errors,
    truncated: report.truncated,
  };
}

function unavailableDependencies(): DependencySummary {
  return {
    available: false,
    ecosystems: [],
    packageManagers: [],
    manifestPaths: [],
    productionCount: 0,
    developmentCount: 0,
    frameworkIndicators: [],
    errors: ["Dependency inspection was not requested or failed."],
    truncated: false,
  };
}

export async function analyzeRepository(
  client: GitHubClient,
  owner: string,
  repo: string,
  options: AnalysisOptions = {},
): Promise<RepositoryAnalysis> {
  const repository = await client.getRepository(owner, repo);
  const ref = await resolveRef(client, owner, repo, options.ref);
  const errors: AnalysisError[] = [];

  const includeDependencies = options.includeDependencies !== false;
  const includeActivity = options.includeActivity !== false;

  const [languagesResult, treeResult, readmeResult, dependenciesResult, activityResult] =
    await Promise.all([
      section("languages", client.getLanguages(owner, repo)),
      section(
        "structure",
        getTreeOverview(client, owner, repo, { ref, maxDepth: 3, limit: 100 }),
      ),
      section("readme", client.getReadme(owner, repo, { maxBytes: 16 * 1024 })),
      includeDependencies
        ? section("dependencies", getRepositoryDependencies(client, owner, repo, ref))
        : Promise.resolve<SectionResult<DependencyReport>>({ value: undefined }),
      includeActivity
        ? section("activity", collectActivity(client, owner, repo))
        : Promise.resolve<SectionResult<ActivitySummary>>({ value: undefined }),
    ]);

  for (const result of [
    languagesResult,
    treeResult,
    readmeResult,
    dependenciesResult,
    activityResult,
  ]) {
    if (result.error !== undefined) errors.push(result.error);
  }

  const allPaths = treeResult.value?.entries.map((entry) => entry.path) ?? [];
  const distribution = languageBreakdown(languagesResult.value ?? {});
  const frameworks = dependenciesResult.value?.frameworkIndicators ?? [];
  const heuristic = (paths: string[]): HeuristicIndicators => ({
    paths,
    basis: "deterministic file-path heuristics",
    inferred: true,
  });
  const dependencyReport = dependenciesResult.value;

  return {
    generatedAt: new Date().toISOString(),
    identity: {
      fullName: repository.full_name,
      description: repository.description,
      url: repository.html_url,
      defaultBranch: repository.default_branch,
      resolvedRef: ref,
      visibility: repository.visibility || (repository.private ? "private" : "public"),
      license: repository.license
        ? { name: repository.license.name, spdxId: repository.license.spdx_id }
        : null,
      createdAt: repository.created_at,
      updatedAt: repository.updated_at,
    },
    languages: {
      primary: repository.language ?? distribution[0]?.name ?? null,
      distribution,
    },
    structure: treeResult.value
      ? {
          entries: treeResult.value.entries,
          directoryCount: treeResult.value.directoryCount,
          fileCount: treeResult.value.fileCount,
          sourceTruncated: treeResult.value.sourceTruncated,
          truncated: treeResult.value.truncated,
        }
      : { entries: [], directoryCount: 0, fileCount: 0, sourceTruncated: false, truncated: true },
    dependencies: dependencyReport ? dependencySummary(dependencyReport) : unavailableDependencies(),
    technologies: {
      frameworkIndicators: frameworks,
      configIndicators: heuristic(configIndicators(allPaths, 30)),
    },
    readme: {
      available: readmeResult.value !== undefined,
      path: readmeResult.value?.path ?? null,
      truncated: readmeResult.value?.truncated ?? false,
    },
    activity: activityResult.value
      ? { ...activityResult.value, pushedAt: repository.pushed_at ?? activityResult.value.pushedAt }
      : {
          available: false,
          recentCommits: [],
          contributors: [],
          recentPullRequests: [],
          pushedAt: repository.pushed_at ?? null,
          errors: ["Activity inspection was not requested or failed."],
        },
    entryPoints: heuristic(matchedPaths(allPaths, ENTRY_POINT_PATTERNS, 10)),
    testing: heuristic(matchedPaths(allPaths, TEST_PATTERNS, 30)),
    ci: heuristic(matchedPaths(allPaths, CI_PATTERNS, 20)),
    documentation: heuristic(matchedPaths(allPaths, DOC_PATTERNS, 20)),
    inferredNote:
      "Entry points, frameworks, testing, CI, and documentation indicators are inferred from file paths and declared dependencies; no repository code was executed or inspected beyond the listed files.",
    errors,
    incomplete: errors.length > 0,
  };
}

async function collectActivity(
  client: GitHubClient,
  owner: string,
  repo: string,
): Promise<ActivitySummary> {
  const [commits, contributors, pulls] = await Promise.all([
    section("activity.commits", client.getCommits(owner, repo, { limit: 5 })),
    section("activity.contributors", client.listContributors(owner, repo, { perPage: 5 })),
    section("activity.pull_requests", client.listPullRequests(owner, repo, { state: "all", limit: 5 })),
  ]);
  const errors = [commits, contributors, pulls]
    .filter((result) => result.error !== undefined)
    .map((result) => result.error!.message);
  return {
    available: errors.length === 0,
    recentCommits: compactCommits(commits.value ?? []),
    contributors: compactContributors(contributors.value?.data ?? []),
    recentPullRequests: compactPulls(pulls.value ?? []),
    pushedAt: null,
    errors,
  };
}

function compactCommits(commits: GitHubCommit[]): ActivitySummary["recentCommits"] {
  return commits.slice(0, 5).map((commit) => ({
    sha: commit.sha,
    message: firstLine(commit.commit?.message ?? ""),
    date: commit.commit?.author?.date ?? null,
    url: commit.html_url,
  }));
}

function compactContributors(contributors: GitHubContributor[]): ActivitySummary["contributors"] {
  return contributors.slice(0, 5).map((contributor) => ({
    login: contributor.login,
    contributions: contributor.contributions,
    profileUrl: contributor.html_url ?? `https://github.com/${contributor.login}`,
  }));
}

function compactPulls(pulls: GitHubPullRequest[]): ActivitySummary["recentPullRequests"] {
  return pulls.slice(0, 5).map((pull) => ({
    number: pull.number,
    title: pull.title,
    state: pull.state,
    url: pull.html_url,
  }));
}
