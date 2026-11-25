/** Strict response shapes for the read-only GitHub REST endpoints RepoLens uses. */

export interface GitHubUser {
  login: string;
  html_url?: string;
  type?: string;
}

export interface GitHubRepository {
  name: string;
  full_name: string;
  description: string | null;
  owner: GitHubUser | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at?: string;
  html_url: string;
  license: { name: string | null; spdx_id: string | null } | null;
  visibility: string;
  private: boolean;
  topics?: string[];
  archived?: boolean;
}

export interface GitHubCommitAuthor {
  name: string;
  date: string;
  email?: string;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: GitHubCommitAuthor | null;
    committer?: GitHubCommitAuthor | null;
  };
  author: GitHubUser | null;
  html_url: string;
  stats?: GitHubStats;
  files?: GitHubChangedFile[];
  parents?: Array<{ sha: string; html_url?: string }>;
}

export interface GitHubStats {
  additions: number;
  deletions: number;
  total: number;
}

export type GitHubCommitDetail = GitHubCommit & {
  stats?: GitHubStats;
  parents: Array<{ sha: string; html_url?: string }>;
  files: GitHubChangedFile[];
};

export interface GitHubChangedFile {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  patch?: string;
  previous_filename?: string;
}

export interface GitHubIssueLabel {
  name: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  user: GitHubUser | null;
  labels: Array<GitHubIssueLabel | string>;
  created_at: string;
  html_url: string;
  /** Present when the API item is actually a pull request; such items are filtered out. */
  pull_request?: unknown;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  user: GitHubUser | null;
  head: { ref: string; sha?: string; repo?: { full_name?: string } | null };
  base: { ref: string; sha?: string; repo?: { full_name?: string } | null };
  created_at: string;
  updated_at?: string;
  html_url: string;
  body?: string | null;
  merged?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string;
  merged_at?: string | null;
  merged_by?: GitHubUser | null;
  draft?: boolean;
  comments?: number;
  review_comments?: number;
  commits?: number;
  changed_files?: number;
  additions?: number;
  deletions?: number;
}

export interface GitHubReview {
  id?: number;
  user: GitHubUser | null;
  state?: string;
  submitted_at?: string | null;
  body?: string | null;
  html_url?: string;
}

export interface GitHubReadme {
  content: string;
  encoding: string;
  path: string;
  html_url: string;
  size?: number;
}

export type GitHubLanguages = Record<string, number>;

export interface DecodedReadme {
  content: string;
  path: string;
  htmlUrl: string;
  bytes: number;
  truncated: boolean;
}

export interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
  url?: string;
}

export interface GitHubTree {
  sha: string;
  url?: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

export interface GitHubContentItem {
  type: string;
  encoding?: string;
  size?: number;
  name: string;
  path: string;
  content?: string;
  sha: string;
  html_url?: string;
  download_url?: string | null;
  git_url?: string | null;
  url?: string;
}

export interface DecodedFile {
  path: string;
  size: number;
  content: string;
  encoding: string;
  sha: string;
  htmlUrl: string;
  binary: boolean;
  truncated: boolean;
}

export interface GitHubCodeMatch {
  text?: string;
  fragment?: string;
  indices?: number[];
}

export interface GitHubCodeTextMatch {
  fragment?: string;
  object?: { path?: string };
  matches?: GitHubCodeMatch[];
}

export interface GitHubCodeSearchItem {
  name: string;
  path: string;
  html_url: string;
  repository?: { full_name?: string };
  text_matches?: GitHubCodeTextMatch[];
}

export interface GitHubCodeSearchResult {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubCodeSearchItem[];
}

export interface GitHubContributor {
  login: string;
  id?: number;
  contributions: number;
  html_url?: string;
  avatar_url?: string;
  type?: string;
  site_admin?: boolean;
}
