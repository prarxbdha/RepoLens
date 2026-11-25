import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import { getTreeOverview } from "../services/repository.js";
import { jsonResult, pathInput, refInput, repoInput, safeTool } from "./common.js";

const treeInput = repoInput.extend({
  ref: refInput,
  path: pathInput.optional(),
  max_depth: z.number().int().min(1).max(10).default(3),
  limit: z.number().int().min(1).max(500).default(100),
});

export function registerTreeTools(server: McpServer, client: GitHubClient): void {
  server.registerTool(
    "get_repo_tree",
    {
      title: "Get repository tree",
      description:
        "Inspect file and directory paths with types and sizes without cloning the repository. Truncated responses are reported.",
      inputSchema: treeInput,
    },
    async ({ owner, repo, ref, path, max_depth, limit }) =>
      safeTool(async () =>
        jsonResult(await getTreeOverview(client, owner, repo, { ref, path, maxDepth: max_depth, limit })),
      ),
  );
}
