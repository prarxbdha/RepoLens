import type { McpServer } from "@modelcontextprotocol/server";
import type { GitHubClient } from "../github/client.js";
import { repoInput, safeTool, textResult } from "./common.js";

export interface LanguageShare {
  name: string;
  bytes: number;
  percentage: number;
}

export function languageBreakdown(languages: Record<string, number>): LanguageShare[] {
  const entries = Object.entries(languages)
    .filter(([, bytes]) => Number.isFinite(bytes) && bytes >= 0)
    .sort((left, right) => right[1] - left[1]);
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  return entries.map(([name, bytes]) => ({
    name,
    bytes,
    percentage: total === 0 ? 0 : Number(((bytes / total) * 100).toFixed(2)),
  }));
}

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
