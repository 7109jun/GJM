# Godot-J-MCP (GJM)

**Version: 2.5.0**

Godot-J-MCP (GJM) is a TypeScript MCP server for AI-driven Godot project creation, validation, repair, runtime behavior automation, assertions, snapshots, artifact collection, and MP4 export.

## Core flow

```text
AI
 ↓
godot.make.json
 ↓
GJM
 ↓
Godot validation
 ├─ error → diagnose → repair → validate again
 └─ success
      ↓
   Behavior.json
      ↓
   keyboard / mouse / click
      ↓
   assertions
      ↓
   recording / MP4
      ↓
   artifacts + result
      ↓
   AI
```

## MCP

GJM uses the official TypeScript MCP SDK v2 with stdio transport.

The server exposes:

- MCP tools for project creation, validation, behavior execution, diagnostics, repair, snapshots, artifacts, and orchestration
- Read-only MCP resources for the GJM JSON schemas and result format
- MCP prompts for common build/test workflows
- Tool annotations for read-only/destructive/idempotent behavior

`tests/mcp-smoke.mjs` is included as a protocol-level smoke test for `initialize`, `tools/list`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`, and `tools/call`.

## Install

Requires Node.js 20+.

```bash
npm install
npm run build
npm start
```

For development:

```bash
npm run dev
```

For MCP Inspector:

```bash
npm run inspect
```

For the MCP protocol smoke test:

```bash
npm run mcp:test
```

Godot and FFmpeg are required for runtime testing and MP4 export.

## Input files

AI can provide `godot.make.json` and `Behavior.json` as uploaded files or inline JSON content.

### godot.make.json

Declares project settings, directories, files, scripts, scenes, and scene nodes.

### Behavior.json

Declares runtime actions such as waiting, keyboard input, mouse movement, clicks, scrolling, and screenshot checkpoints. Assertions can verify frames, checkpoints, stdout/stderr, and project files.

## Security

GJM keeps project file operations inside the configured project root, rejects path traversal, validates JSON input, and supports rollback snapshots before destructive project operations.

## GitHub repository contents

The repository intentionally does **not** include generated `node_modules`, the local Godot binary, generated MP4 files, or local `.gjm-*` runtime data.

## Verification

The GJM engine has been exercised against Godot 3.6.3 and FFmpeg in the development environment. See `docs/VERIFY-RESULTS-2.5.md` for the recorded verification results.
