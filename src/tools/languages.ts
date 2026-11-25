import type { McpServer } from "@modelcontextprotocol/server";
import type { GitHubClient } from "../github/client.js";
import { languageBreakdown, type LanguageShare } from "../services/languages.js";
import { repoInput, safeTool, textResult } from "./common.js";

export { languageBreakdown, type LanguageShare } from "../services/languages.js";

export function formatLanguages(languages: Record<string, number>): string[] {
  const shares = languageBreakdown(languages);
  if (shares.length === 0) return ["No language data found."];
  return [
    `Language, Bytes, Share`,
    ...shares.map((share) => `${share.name}, ${share.bytes}, ${share.percentage.toFixed(2)}%`),
  ];
}

export function registerLanguageTools(server: McpServer, client: GitHubClient): void {
  server.registerTool(
    "get_repo_languages",
    {
      title: "Get repository languages",
      description: "Show byte counts and percentage distribution of repository languages.",
      inputSchema: repoInput,
    },
    async ({ owner, repo }) =>
      safeTool(async () => textResult(formatLanguages(await client.getLanguages(owner, repo)))),
  );
}
