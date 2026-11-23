# RepoLens

RepoLens is a beginner-friendly [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
server written in TypeScript. This is the smallest possible starting point: a local
server that speaks MCP over stdio and exposes one tool, `ping`, which returns `pong`.

GitHub API integration is intentionally **not** implemented yet.

## Requirements

- Node.js 20 or newer
- npm

The project uses the v2 MCP TypeScript SDK (`@modelcontextprotocol/server`).

## Install

```bash
npm install
```

## Scripts

| Command           | What it does                                      |
| ----------------- | ------------------------------------------------- |
| `npm run build`   | Type-check and compile `src/` into `dist/`         |
| `npm run dev`     | Run the TypeScript source with auto-reload (`tsx`) |
| `npm run typecheck` | Type-check without emitting files                |
| `npm start`       | Run the compiled server from `dist/`               |

## Connecting an MCP client

Build first, then configure your client to launch the server over stdio:

```json
{
  "mcpServers": {
    "repolens": {
      "command": "node",
      "args": ["/absolute/path/to/RepoLens/dist/index.js"]
    }
  }
}
```

For development you can use `npm run dev -- --` style commands in clients that
support them, or point the client at `npx tsx /absolute/path/to/RepoLens/src/index.ts`.

> **Important:** an stdio MCP server uses stdout exclusively for JSON-RPC
> messages. RepoLens writes all human-readable logs to stderr, so they never
> corrupt the protocol stream.

## Available tools

- `ping` — takes no input and returns the text `pong`. Use it to verify that the
  server process and MCP connection are working.

## Project layout

- `src/index.ts` — creates the `McpServer`, registers the `ping` tool, and starts
  the stdio transport.
- `tsconfig.json` — strict TypeScript settings, ESM (`NodeNext`), and `src/` →
  `dist/` compilation.
- `package.json` — dependencies and build/dev/start scripts.
- `.gitignore` — keeps generated output, installed packages, and local secrets
  out of Git.

No commits have been made yet.
