import type { McpServer } from "@modelcontextprotocol/server";
import type { GitHubClient } from "../github/client.js";
import { getRepositoryDependencies } from "../services/dependencies.js";
import { jsonResult, refInput, repoInput, safeTool } from "./common.js";

const dependencyInput = repoInput.extend({ ref: refInput });

export function registerDependencyTools(server: McpServer, client: GitHubClient): void {
  server.registerTool(
    "get_repo_dependencies",
    {
      title: "Get repository dependencies",
      description:
        "Detect and parse declared dependencies in common manifests across multiple ecosystems. Manifests are never executed.",
      inputSchema: dependencyInput,
    },
    async ({ owner, repo, ref }) =>
      safeTool(async () => {
        const report = await getRepositoryDependencies(client, owner, repo, ref);
        return jsonResult({
          ...report,
          dependencyStatus: "declared only; not installed or resolved",
        });
      }),
  );
}
