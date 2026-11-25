import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import { jsonResult, boundedLimit, repoInput, safeTool } from "./common.js";

const searchInput = repoInput.extend({
  query: z.string().trim().min(1).max(200),
  language: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9+#.-]+$/).optional(),
  extension: z.string().trim().min(1).max(50).regex(/^\.?[A-Za-z0-9]+$/).optional(),
  limit: boundedLimit(30, 20),
});

export function registerSearchTools(server: McpServer, client: GitHubClient): void {
  server.registerTool(
    "search_code",
    {
      title: "Search repository code",
      description:
        "Search code in a repository using GitHub's authenticated code search API. Results are never fabricated when search is unavailable.",
      inputSchema: searchInput,
    },
    async ({ owner, repo, query, language, extension, limit }) =>
      safeTool(async () => {
        const result = await client.searchCode(owner, repo, { query, language, extension, limit });
        const items = result.items.slice(0, limit);
        return jsonResult({
          owner,
          repo,
          query,
          language: language ?? null,
          extension: extension ?? null,
          totalMatchCount: result.total_count,
          returnedMatches: items.length,
          matches: items.map((item) => ({
            path: item.path,
            url: item.html_url,
            repository: item.repository?.full_name ?? `${owner}/${repo}`,
            textMatches: item.text_matches ?? [],
          })),
          incompleteResults: result.incomplete_results,
          truncated: result.incomplete_results || result.total_count > items.length,
          limitations: [
            "GitHub code search requires GITHUB_TOKEN access and may return fewer results for indexing or rate-limit reasons.",
            "Text match fragments are included only when GitHub supplies them.",
          ],
          untrustedData: true,
        });
      }),
  );
}
