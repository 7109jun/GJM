#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import process from 'node:process';
import path from 'node:path';

const entry = path.resolve(process.argv[2] ?? 'dist/index.js');
const client = new Client({ name: 'gjm-smoke-test', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [entry] });

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = new Set(tools.tools.map(t => t.name));
  const requiredTools = ['gjm_execute', 'gjm_diagnose', 'gjm_artifacts', 'gjm_snapshot_create'];
  for (const name of requiredTools) {
    if (!toolNames.has(name)) throw new Error(`Missing MCP tool: ${name}`);
  }

  const resources = await client.listResources();
  const resourceUris = new Set(resources.resources.map(r => r.uri));
  for (const uri of ['gjm://schema/godot.make.json', 'gjm://schema/Behavior.json', 'gjm://schema/result.json']) {
    if (!resourceUris.has(uri)) throw new Error(`Missing MCP resource: ${uri}`);
  }

  const behaviorSchema = await client.readResource({ uri: 'gjm://schema/Behavior.json' });
  if (!behaviorSchema.contents?.[0]?.text?.includes('godot.behavior')) {
    throw new Error('Behavior resource did not return valid schema text');
  }

  const prompts = await client.listPrompts();
  const promptNames = new Set(prompts.prompts.map(p => p.name));
  for (const name of ['gjm-build-game', 'gjm-test-game']) {
    if (!promptNames.has(name)) throw new Error(`Missing MCP prompt: ${name}`);
  }

  const prompt = await client.getPrompt({
    name: 'gjm-test-game',
    arguments: { goal: 'load the main scene and capture a checkpoint' }
  });
  if (!prompt.messages?.length) throw new Error('Prompt returned no messages');

  const result = await client.callTool({
    name: 'gjm_environment',
    arguments: {}
  });
  if (result.isError) throw new Error('gjm_environment returned a tool error');

  console.log(JSON.stringify({
    ok: true,
    protocol: client.getNegotiatedProtocolVersion(),
    instructions: Boolean(client.getInstructions()),
    toolCount: tools.tools.length,
    resourceCount: resources.resources.length,
    promptCount: prompts.prompts.length,
    calledTool: 'gjm_environment'
  }, null, 2));
} finally {
  await client.close().catch(() => {});
}
