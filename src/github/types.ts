/** Minimal response shapes for the read-only GitHub REST endpoints RepoLens uses. */

export interface GitHubUser {
  login: string;
  html_url?: string;
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
  html_url: string;
  license: { name: string | null; spdx_id: string | null } | null;
  visibility: string;
  private: boolean;
}

export interface GitHubCommitAuthor {
  name: string;
  date: string;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: GitHubCommitAuthor | null;
  };
  author: GitHubUser | null;
  html_url: string;
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
  head: { ref: string };
  base: { ref: string };
  created_at: string;
  html_url: string;
}

export interface GitHubReadme {
  content: string;
  encoding: string;
  path: string;
  html_url: string;
}

export type GitHubLanguages = Record<string, number>;

export interface DecodedReadme {
  content: string;
  path: string;
  htmlUrl: string;
  bytes: number;
  truncated: boolean;
}
