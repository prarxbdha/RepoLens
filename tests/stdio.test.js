import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The installed v2 SDK build negotiates this revision, as observed from its
// initialize response. Keep the test client deliberately small and dependency-free.
const PROTOCOL_VERSION = "2025-11-25";

async function startClient() {
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: projectRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim() !== "") {
        const message = JSON.parse(line);
        if (message.id !== undefined && pending.has(message.id)) {
          pending.get(message.id)(message);
          pending.delete(message.id);
        }
      }
      newline = buffer.indexOf("\n");
    }
  });

  function request(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  }

  function notify(method, params = {}) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async function close() {
    if (child.exitCode === null) {
      child.stdin.end();
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }

  const init = await request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "repolens-test", version: "0.1.0" },
  });
  notify("notifications/initialized");

  return { request, close, init, stderr: () => stderr };
}

test("MCP stdio server", async (t) => {
  const client = await startClient();
  t.after(() => client.close());

  await t.test("initialize negotiates a server with tool capability", () => {
    assert.equal(client.init.result.serverInfo.name, "repolens");
    assert.equal(client.init.result.serverInfo.version, "0.1.0");
    assert.ok(client.init.result.capabilities.tools);
  });

  await t.test("tools/list discovers every tool and the ping schema", async () => {
    const response = await client.request("tools/list");
    const names = response.result.tools.map((tool) => tool.name);
    assert.deepEqual(names.sort(), [
      "analyze_repository",
      "get_commit_details",
      "get_commits",
      "get_contributors",
      "get_file_content",
      "get_pr_details",
      "get_repo_dependencies",
      "get_repo_info",
      "get_repo_languages",
      "get_repo_readme",
      "get_repo_tree",
      "list_issues",
      "list_pull_requests",
      "ping",
      "search_code",
    ]);
    const ping = response.result.tools.find((tool) => tool.name === "ping");
    assert.ok(ping, "the ping tool must be discoverable");
    assert.equal(ping.title, "Ping");
    assert.match(ping.description, /pong/);
    assert.equal(ping.inputSchema.type, "object");
    assert.deepEqual(ping.inputSchema.properties, {});
  });

  await t.test("tools/call invokes ping and returns pong", async () => {
    const response = await client.request("tools/call", {
      name: "ping",
      arguments: {},
    });
    assert.deepEqual(response.result.content, [
      { type: "text", text: "pong" },
    ]);
  });

  await t.test("protocol-level ping is handled by the SDK", async () => {
    const response = await client.request("ping");
    assert.deepEqual(response.result, {});
  });

  await t.test("an unknown tool returns a JSON-RPC error", async () => {
    const response = await client.request("tools/call", {
      name: "does-not-exist",
      arguments: {},
    });
    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, /does-not-exist/);
  });

  await t.test("diagnostics are written to stderr", () => {
    assert.match(client.stderr(), /MCP server listening on stdio/);
  });
});
