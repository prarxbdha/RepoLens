import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { describeError } from "../github/client.js";

const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

export const repoInput = z.object({
  owner: z.string().trim().min(1).max(100).regex(NAME_PATTERN, "Invalid repository owner"),
  repo: z.string().trim().min(1).max(100).regex(NAME_PATTERN, "Invalid repository name"),
});

export const limitInput = z.number().int().min(1).max(50).default(10);
export const stateInput = z.enum(["open", "closed", "all"]);

export function textResult(lines: string[]): CallToolResult {
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export function errorResult(error: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: `RepoLens error: ${describeError(error)}` }],
    isError: true,
  };
}

export async function safeTool(
  handler: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await handler();
  } catch (error) {
    return errorResult(error);
  }
}
