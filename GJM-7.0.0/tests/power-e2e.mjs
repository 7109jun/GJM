import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.argv[2] || path.resolve('.');
const server = path.join(root, 'dist/src/index.js');
const project = path.join('/mnt/data', 'gjm-7-power-project');
await fs.rm(project, { recursive: true, force: true });
await fs.mkdir(path.join(project,'animations'), { recursive: true });
await fs.mkdir(path.join(project,'shaders'), { recursive: true });
await fs.writeFile(path.join(project,'project.godot'), '[application]\nconfig/name="GJM Power Test"\n[input]\njump={"deadzone":0.5,"events":[]}\n');
await fs.writeFile(path.join(project,'test.gd'), 'extends Node\nfunc _ready():\n    print("POWER_OK")\n');
await fs.writeFile(path.join(project,'animations','clip.gjm.animation.json'), JSON.stringify({format:'gjm.animation',version:1,tracks:[{property:'position',keys:[{time:0,value:[0,0,0]}]}]}));

const p = spawn(process.execPath,[server],{stdio:['pipe','pipe','pipe']});
let buf='';
p.stdout.on('data',d=>buf+=d); p.stderr.on('data',d=>process.stderr.write(d));
let id=0;
function call(name,args){return new Promise((resolve,reject)=>{const my=++id;const on=()=>{for(const line of buf.split('\n')){if(!line.trim())continue;let r;try{r=JSON.parse(line)}catch{continue}if(r.id===my){buf=buf.slice(buf.indexOf(line)+line.length+1);p.stdout.off('data',on);resolve(r);return}}};p.stdout.on('data',on);p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:my,method:'tools/call',params:{name,arguments:args}})+'\n');setTimeout(()=>{p.stdout.off('data',on);reject(new Error('timeout '+name))},15000)});}
p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:++id,method:'initialize',params:{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'power-test',version:'1'}}})+'\n');
await new Promise(r=>setTimeout(r,200));
for (const [name,args] of [
  ['gjm_audit',{projectRoot:project}],
  ['gjm_texture',{projectRoot:project,kind:'checker',output:'textures/test.png',width:32,height:32}],
  ['gjm_animation_edit',{projectRoot:project,file:'animations/clip.gjm.animation.json',action:'add_key',time:1,value:[1,0,0]}],
  ['gjm_input_audit',{projectRoot:project,actions:['jump']}],
  ['gjm_release_readiness',{projectRoot:project}]
]) { const r=await call(name,args); if(r.error) throw new Error(JSON.stringify(r.error)); const t=r.result?.content?.[0]?.text||''; if(!t.includes('"code"')) throw new Error(name+' did not return structured result'); }
await new Promise(r=>p.kill('SIGTERM') && setTimeout(r,150));
console.log('GJM-7-POWER-E2E PASS');
