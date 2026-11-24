import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import type { GitHubCommit } from "../github/types.js";
import { limitInput, repoInput, safeTool, textResult } from "./common.js";

const commitInput = repoInput.extend({
  branch: z.string().trim().min(1).max(255).optional(),
  limit: limitInput,
});

function firstLine(message: string): string {
  return message.split("\n", 1)[0]?.trim() || "(no message)";
}

export function formatCommits(commits: GitHubCommit[]): string[] {
  if (commits.length === 0) return ["No commits found."];
  return commits.flatMap((commit, index) => {
    const author = commit.commit.author?.name ?? commit.author?.login ?? "(unknown)";
    const lines = [
      `${index + 1}. ${commit.sha.slice(0, 12)}`,
      `   Message: ${firstLine(commit.commit.message)}`,
      `   Author: ${author}`,
      `   Timestamp: ${commit.commit.author?.date ?? "(unknown)"}`,
      `   URL: ${commit.html_url}`,
    ];
    return index === commits.length - 1 ? lines : [...lines, ""];
  });
}

export function registerCommitTools(server: McpServer, client: GitHubClient): void {
  server.registerTool(
    "get_commits",
    {
      title: "Get commits",
      description: "List recent commits for a repository and optional branch.",
      inputSchema: commitInput,
    },
    async ({ owner, repo, branch, limit }): Promise<CallToolResult> =>
      safeTool(async () =>
        textResult(formatCommits(await client.getCommits(owner, repo, { branch, limit }))),
      ),
  );
}
