import { McpServer } from "@modelcontextprotocol/server";
import { GitHubClient } from "./github/client.js";
import { registerAnalysisTools } from "./tools/analysis.js";
import { registerCommitTools } from "./tools/commits.js";
import { registerContributorTools } from "./tools/contributors.js";
import { registerDependencyTools } from "./tools/dependencies.js";
import { registerFileTools } from "./tools/files.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerLanguageTools } from "./tools/languages.js";
import { registerPingTool } from "./tools/ping.js";
import { registerPullTools } from "./tools/pulls.js";
import { registerReadmeTools } from "./tools/readme.js";
import { registerRepoTools } from "./tools/repo.js";
import { registerSearchTools } from "./tools/search.js";
import { registerTreeTools } from "./tools/tree.js";

export const SERVER_NAME = "repolens";
export const SERVER_VERSION = "0.1.0";

export function createServer(client: GitHubClient = new GitHubClient()): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  registerPingTool(server);
  registerRepoTools(server, client);
  registerCommitTools(server, client);
  registerIssueTools(server, client);
  registerPullTools(server, client);
  registerLanguageTools(server, client);
  registerReadmeTools(server, client);
  registerTreeTools(server, client);
  registerFileTools(server, client);
  registerSearchTools(server, client);
  registerDependencyTools(server, client);
  registerContributorTools(server, client);
  registerAnalysisTools(server, client);

  return server;
}
