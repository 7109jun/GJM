# GJM MCP conformance

GJM is implemented as a real MCP server using the official TypeScript SDK v2 package `@modelcontextprotocol/server` 2.0.0. The stdio entrypoint is `serveStdio(createServer)`, which is the SDK-recommended path for local process integrations.

The server exposes MCP tools, resources, and prompts. `tests/mcp-smoke.mjs` uses the official `@modelcontextprotocol/client` package and `StdioClientTransport` to exercise:

1. MCP connection / protocol negotiation
2. `tools/list`
3. `resources/list`
4. `resources/read`
5. `prompts/list`
6. `prompts/get`
7. `tools/call`

Run:

```bash
npm install
npm run build
npm run mcp:test
```

For interactive inspection:

```bash
npm run inspect
```

GJM logs diagnostic messages to stderr. stdout is reserved for MCP transport traffic.
