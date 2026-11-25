import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import { analyzeRepository } from "../services/repositoryAnalyzer.js";
import { jsonResult, refInput, repoInput, safeTool } from "./common.js";

const analysisInput = repoInput.extend({
  ref: refInput,
  include_activity: z.boolean().default(true),
  include_dependencies: z.boolean().default(true),
});

export function registerAnalysisTools(server: McpServer, client: GitHubClient): void {
  server.registerTool(
    "analyze_repository",
    {
      title: "Analyze repository",
      description:
        "Build a structured repository report from metadata, languages, tree, manifests, README, and optional activity. Heuristics are labelled as inferred.",
      inputSchema: analysisInput,
    },
    async ({ owner, repo, ref, include_activity, include_dependencies }) =>
      safeTool(async () =>
        jsonResult(
          await analyzeRepository(client, owner, repo, {
            ref,
            includeActivity: include_activity,
            includeDependencies: include_dependencies,
          }),
        ),
      ),
  );
}
