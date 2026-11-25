import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import { jsonResult, repoInput, safeTool } from "./common.js";

const contributorInput = repoInput.extend({
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(100).default(30),
});

export function registerContributorTools(server: McpServer, client: GitHubClient): void {
  server.registerTool(
    "get_contributors",
    {
      title: "Get contributors",
      description:
        "List repository contributors with contribution counts, profile URLs, and account types. Supports bounded pagination.",
      inputSchema: contributorInput,
    },
    async ({ owner, repo, page, limit }) =>
      safeTool(async () => {
        const result = await client.listContributors(owner, repo, { page, perPage: limit });
        return jsonResult({
          owner,
          repo,
          page,
          perPage: limit,
          contributors: result.data.map((contributor) => ({
            username: contributor.login,
            contributions: contributor.contributions,
            profileUrl: contributor.html_url ?? `https://github.com/${contributor.login}`,
            accountType: contributor.type ?? "unknown",
          })),
          totalReturned: result.data.length,
          hasNextPage: result.hasNextPage,
          truncated: result.hasNextPage,
        });
      }),
  );
}
