import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { textResult } from "./common.js";

export function registerPingTool(server: McpServer): void {
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Returns pong so you can check that RepoLens is running.",
      inputSchema: z.object({}),
    },
    async (): Promise<CallToolResult> => textResult(["pong"]),
  );
}
