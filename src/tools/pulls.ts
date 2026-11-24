import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type { GitHubClient } from "../github/client.js";
import type { GitHubPullRequest } from "../github/types.js";
import { limitInput, repoInput, safeTool, stateInput, textResult } from "./common.js";

const pullInput = repoInput.extend({
  state: stateInput,
  limit: limitInput,
});

export function formatPullRequests(pulls: GitHubPullRequest[]): string[] {
  if (pulls.length === 0) return ["No pull requests found."];
  return pulls.flatMap((pull, index) => {
    const lines = [
      `${index + 1}. #${pull.number} ${pull.title}`,
      `   Author: ${pull.user?.login ?? "(unknown)"}`,
      `   State: ${pull.state}`,
      `   Branches: ${pull.head?.ref ?? "?"} -> ${pull.base?.ref ?? "?"}`,
      `   Created: ${pull.created_at}`,
      `   URL: ${pull.html_url}`,
    ];
    return index === pulls.length - 1 ? lines : [...lines, ""];
  });
}

export function registerPullTools(server: McpServer, client: GitHubClient): void {
  server.registerTool(
    "list_pull_requests",
    {
      title: "List pull requests",
      description: "List pull requests for a repository with source and target branches.",
      inputSchema: pullInput,
    },
    async ({ owner, repo, state, limit }): Promise<CallToolResult> =>
      safeTool(async () =>
        textResult(formatPullRequests(await client.listPullRequests(owner, repo, { state, limit }))),
      ),
  );
}
