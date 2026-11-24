import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";

function log(message: string): void {
  // stdout belongs to MCP JSON-RPC; diagnostics must go to stderr.
  process.stderr.write(`[repolens] ${message}\n`);
}

serveStdio(() => createServer(), {
  onerror: (error) => log(`transport error: ${error.message}`),
});

log("MCP server listening on stdio");
