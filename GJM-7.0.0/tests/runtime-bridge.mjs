#!/usr/bin/env node
import { startRuntime, runtimeCommand, stopRuntime, readRuntime } from '../dist/src/runtime.js';

const root = process.argv[2];
if (!root) throw new Error('Usage: node tests/runtime-bridge.mjs <projectRoot>');

const checks = [];
let stopped = false;
try {
  const state = await startRuntime(root);
  checks.push(['start', Boolean(state.id && state.token && state.port > 0)]);
  checks.push(['ping', (await runtimeCommand(root, { op: 'ping' })).result === 'pong']);
  const info = await runtimeCommand(root, { op: 'runtime_info' });
  checks.push(['runtime_info', info.ok === true && !!info.engine && typeof info.current_scene === 'string' && Number(info.node_count) >= 1]);
  const tree = await runtimeCommand(root, { op: 'tree' });
  checks.push(['tree', Array.isArray(tree.nodes) && tree.nodes.length >= 1]);
  const subtree = await runtimeCommand(root, { op: 'tree', path: 'Label' });
  checks.push(['tree_subtree', subtree.ok === true && Array.isArray(subtree.nodes) && subtree.nodes.length === 1]);
  const before = await runtimeCommand(root, { op: 'get_property', path: 'Label', property: 'text' });
  checks.push(['get_property', before.value === 'Initial']);
  const set = await runtimeCommand(root, { op: 'set_property', path: 'Label', property: 'text', value: 'GJM Runtime' });
  checks.push(['set_property', set.value === 'GJM Runtime']);
  const after = await runtimeCommand(root, { op: 'get_property', path: 'Label', property: 'text' });
  checks.push(['get_after_set', after.value === 'GJM Runtime']);
  const call = await runtimeCommand(root, { op: 'call_method', path: '.', method: 'hello', args: ['GJM'] });
  checks.push(['call_method', call.result === 'hello:GJM']);
  const rejected = await runtimeCommand(root, { op: 'tree', path: 'DoesNotExist' });
  checks.push(['invalid_path', rejected.ok === false && rejected.error === 'node_not_found']);
  const shot = await runtimeCommand(root, { op: 'screenshot', path: 'res://runtime.png' });
  checks.push(['screenshot', shot.ok === true]);
  await stopRuntime(root); stopped = true;
  checks.push(['stop', (await readRuntime(root)) === null]);
  const failed = checks.filter(([, ok]) => !ok);
  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
  if (failed.length) process.exit(1);
} finally {
  if (!stopped) { try { await stopRuntime(root); } catch {} }
}
