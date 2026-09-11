# GJM 2.5 Specification

## MCP-facing improvements

- Uses MCP TypeScript SDK v2 `McpServer` + `serveStdio`.
- Adds `gjm_server_info` for machine-readable server metadata.
- Key tools expose MCP annotations: read-only, destructive, idempotent, and open-world hints.
- Keeps stdout reserved for MCP protocol traffic; diagnostics belong on stderr.
- Existing GJM workflow remains: make → validate → diagnose/fix → Behavior → assertions → MP4 → artifacts.

## New tool

`gjm_server_info` returns protocol-facing metadata, formats, workflow entry points, and feature flags.
