import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

function log(message: string): void {
  // stdout belongs to MCP JSON-RPC; diagnostics must go to stderr.
  process.stderr.write(`[repolens] ${message}\n`);
}

function createServer(): McpServer {
  const server = new McpServer(
    { name: "repolens", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const pong: CallToolResult = {
    content: [{ type: "text", text: "pong" }],
  };

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Returns pong so you can check that RepoLens is running.",
    },
    async (): Promise<CallToolResult> => pong,
  );

  return server;
}

serveStdio(() => createServer(), {
  onerror: (error) => log(`transport error: ${error.message}`),
});

log("MCP server listening on stdio");
