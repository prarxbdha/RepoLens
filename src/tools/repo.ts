import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type { GitHubClient } from "../github/client.js";
import type { GitHubRepository } from "../github/types.js";
import { repoInput, safeTool, textResult } from "./common.js";

export function formatRepoInfo(repo: GitHubRepository): string[] {
  const license = repo.license?.spdx_id ?? repo.license?.name ?? "none";
  return [
    `Repository: ${repo.full_name}`,
    `Description: ${repo.description ?? "(none)"}`,
    `Owner: ${repo.owner?.login ?? "(unknown)"}`,
    `Primary language: ${repo.language ?? "(none)"}`,
    `Stars: ${repo.stargazers_count}`,
    `Forks: ${repo.forks_count}`,
    `Open issues: ${repo.open_issues_count} (GitHub's count includes pull requests)`,
    `Default branch: ${repo.default_branch}`,
    `Created: ${repo.created_at}`,
    `Updated: ${repo.updated_at}`,
    `URL: ${repo.html_url}`,
    `License: ${license}`,
    `Visibility: ${repo.visibility || (repo.private ? "private" : "public")}`,
  ];
}

export function registerRepoTools(server: McpServer, client: GitHubClient): void {
  server.registerTool(
    "get_repo_info",
    {
      title: "Get repository information",
      description: "Read metadata for a public GitHub repository, or one accessible with GITHUB_TOKEN.",
      inputSchema: repoInput,
    },
    async ({ owner, repo }): Promise<CallToolResult> =>
      safeTool(async () => textResult(formatRepoInfo(await client.getRepository(owner, repo)))),
  );
}
