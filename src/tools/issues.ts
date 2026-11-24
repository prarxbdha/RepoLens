import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type { GitHubClient } from "../github/client.js";
import type { GitHubIssue } from "../github/types.js";
import { limitInput, repoInput, safeTool, stateInput, textResult } from "./common.js";

const issueInput = repoInput.extend({
  state: stateInput,
  limit: limitInput,
});

function labelNames(labels: GitHubIssue["labels"]): string {
  const names = labels
    .map((label) => (typeof label === "string" ? label : label.name))
    .filter((name) => name.length > 0);
  return names.length > 0 ? names.join(", ") : "(none)";
}

export function formatIssues(issues: GitHubIssue[]): string[] {
  if (issues.length === 0) return ["No issues found."];
  return issues.flatMap((issue, index) => {
    const lines = [
      `${index + 1}. #${issue.number} ${issue.title}`,
      `   State: ${issue.state}`,
      `   Author: ${issue.user?.login ?? "(unknown)"}`,
      `   Labels: ${labelNames(issue.labels)}`,
      `   Created: ${issue.created_at}`,
      `   URL: ${issue.html_url}`,
    ];
    return index === issues.length - 1 ? lines : [...lines, ""];
  });
}

export function registerIssueTools(server: McpServer, client: GitHubClient): void {
  server.registerTool(
    "list_issues",
    {
      title: "List issues",
      description: "List issues for a repository. Pull requests are excluded.",
      inputSchema: issueInput,
    },
    async ({ owner, repo, state, limit }): Promise<CallToolResult> =>
      safeTool(async () =>
        textResult(formatIssues(await client.listIssues(owner, repo, { state, limit }))),
      ),
  );
}
