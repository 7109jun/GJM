import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const server = spawn(process.execPath, [resolve('dist/src/index.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '';
const pending = new Map();
let nextId = 1;
const stderr = [];
server.stdout.setEncoding('utf8');
server.stderr.setEncoding('utf8');
server.stderr.on('data', d => stderr.push(d));
server.stdout.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0,index).trim();
    buffer = buffer.slice(index+1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined) pending.get(msg.id)?.(msg);
  }
});
function call(method, params={}) {
  return new Promise((resolvePromise, reject)=>{
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout: ${method}`)); }, 5000);
    pending.set(id, msg => { clearTimeout(timer); pending.delete(id); resolvePromise(msg); });
    server.stdin.write(JSON.stringify({jsonrpc:'2.0', id, method, params})+'\n');
  });
}
try {
  const init = await call('initialize', {
    protocolVersion: '2026-07-28',
    capabilities: {},
    clientInfo: { name: 'gjm-native-smoke', version: '1.0.0' }
  });
  if (init.error) throw new Error(JSON.stringify(init.error));
  server.stdin.write(JSON.stringify({jsonrpc:'2.0', method:'notifications/initialized'})+'\n');
  const tools = await call('tools/list');
  const resources = await call('resources/list');
  const prompts = await call('prompts/list');
  const info = await call('tools/call', {name:'gjm_server_info', arguments:{}});
  const schema = await call('resources/read', {uri:'gjm://schema/godot.make.json'});
  if (tools.result.tools.length < 30) throw new Error(`too few tools: ${tools.result.tools.length}`);
  if (resources.result.resources.length < 4) throw new Error(`too few resources: ${resources.result.resources.length}`);
  if (prompts.result.prompts.length < 4) throw new Error(`too few prompts: ${prompts.result.prompts.length}`);
  if (info.error) throw new Error(JSON.stringify(info.error));
  if (schema.error) throw new Error(JSON.stringify(schema.error));
  console.log(JSON.stringify({
    ok:true,
    protocol:init.result.protocolVersion,
    tools:tools.result.tools.length,
    resources:resources.result.resources.length,
    prompts:prompts.result.prompts.length,
    stderr:stderr.join('').trim()
  }));
} finally {
  server.kill('SIGTERM');
}
