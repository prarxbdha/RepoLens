import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createServer } from "../dist/server.js";

const PROTOCOL_VERSION = "2025-11-25";

export function createMockFetch(handler) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    calls.push({ url, init });
    const result = await handler(url, init);
    if (result instanceof Response) return result;
    const { status = 200, body, headers = {} } = result;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  };
  return { fetchImpl, calls };
}

export async function createInMemoryClient(client) {
  const server = createServer(client);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await clientTransport.start();

  const pending = new Map();
  let nextId = 1;
  clientTransport.onmessage = (message) => {
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };

  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      clientTransport
        .send({ jsonrpc: "2.0", id, method, params })
        .catch(reject);
    });

  const notify = (method, params = {}) =>
    clientTransport.send({ jsonrpc: "2.0", method, params });

  const init = await request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "repolens-test", version: "0.1.0" },
  });
  await notify("notifications/initialized");

  return {
    init,
    request,
    async close() {
      await clientTransport.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}
