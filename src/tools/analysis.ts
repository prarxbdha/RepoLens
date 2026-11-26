import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import { analyzeRepository } from "../services/repositoryAnalyzer.js";
import { jsonResult, refInput, repoInput, safeTool } from "./common.js";

const analysisInput = repoInput.extend({
  ref: refInput,
  include_activity: z.boolean().default(true),
  include_dependencies: z.boolean().default(true),
  include_source_analysis: z.boolean().default(false),
  max_analysis_files: z.number().int().min(1).max(100).default(20),
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
    async ({
      owner,
      repo,
      ref,
      include_activity,
      include_dependencies,
      include_source_analysis,
      max_analysis_files,
    }) =>
      safeTool(async () =>
        jsonResult(
          await analyzeRepository(client, owner, repo, {
            ref,
            includeActivity: include_activity,
            includeDependencies: include_dependencies,
            includeSourceAnalysis: include_source_analysis,
            maxAnalysisFiles: max_analysis_files,
          }),
        ),
      ),
  );
}
