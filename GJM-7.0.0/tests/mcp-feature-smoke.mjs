import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const root='/mnt/data/gjm-6.1-mcp-feature';
await fs.rm(root,{recursive:true,force:true}); await fs.mkdir(root,{recursive:true});
await fs.writeFile(path.join(root,'project.godot'), 'config_version=4\n\n[application]\nconfig/name="GJM Feature"\nrun/main_scene="res://main.tscn"\n','utf8');
await fs.writeFile(path.join(root,'main.tscn'),'[gd_scene format=2]\n\n[node name="Main" type="Node2D"]\n','utf8');
const proc=spawn(process.execPath,['dist/src/index.js'],{cwd:'/mnt/data/Godot-J-MCP-6.1.0',env:{...process.env,GODOT_BIN:'/mnt/data/godot-real/Godot_v3.6.3-stable_mono_x11_64/Godot_v3.6.3-stable_mono_x11.64',TERM:'xterm'},stdio:['pipe','pipe','pipe']});
let id=0; const pending=new Map(); let buf='';
proc.stdout.on('data',d=>{buf+=d.toString(); for(;;){const i=buf.indexOf('\n'); if(i<0)break; const line=buf.slice(0,i); buf=buf.slice(i+1); if(!line.trim())continue; const m=JSON.parse(line); if(m.id!==undefined){const r=pending.get(m.id); if(r){pending.delete(m.id); r(m);}}}});
proc.stderr.on('data',d=>{});
function call(method,params){return new Promise((resolve,reject)=>{const req={jsonrpc:'2.0',id:++id,method,params};pending.set(req.id,resolve);proc.stdin.write(JSON.stringify(req)+'\n'); setTimeout(()=>{if(pending.has(req.id)){pending.delete(req.id);reject(new Error('timeout '+method));}},15000);});}
const init=await call('initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'smoke',version:'1'}}); const out={init:init.result?.serverInfo}; await call('notifications/initialized',{}).catch(()=>{});
async function tool(name,arguments_){const r=await call('tools/call',{name,arguments:arguments_}); if(r.error) throw new Error(r.error.message); return JSON.parse(r.result.content[0].text);}
out.server=await tool('gjm_server_info',{});
out.model=await tool('gjm_model',{projectRoot:root,kind:'cube',output:'models/cube.obj',size:2});
out.rig=await tool('gjm_rig',{projectRoot:root,output:'rigs/rig.json'});
out.animation=await tool('gjm_animation',{projectRoot:root,output:'animations/walk.gjm.animation.json',tracks:[{time:0,value:[0,0]},{time:1,value:[10,0]}]});
out.shader=await tool('gjm_shader',{projectRoot:root,type:'canvas_item',output:'shaders/test.shader',uniforms:[{name:'strength',type:'float',default:1}]});
const wav=Buffer.alloc(44); wav.write('RIFF'); wav.write('WAVE',8); wav.write('fmt ',12); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); out.audio=await tool('gjm_audio',{projectRoot:root,output:'audio/test.wav',base64:wav.toString('base64')});
out.input=await tool('gjm_input',{projectRoot:root,action:'jump',deadzone:0.2,events:[]});
out.network=await tool('gjm_network',{projectRoot:root,mode:'enet',port:7788});
out.validate=await tool('gjm_validate',{projectRoot:root});
out.plan=await tool('gjm_plan',{steps:[{id:'m',op:'model',args:{kind:'plane'}},{id:'s',op:'shader',args:{output:'shaders/p.shader'}}]});
out.parallel=await tool('gjm_parallel',{projectRoot:root,maxConcurrency:2,jobs:[{op:'create_file',args:{path:'parallel/a.txt',content:'A'}},{op:'create_file',args:{path:'parallel/b.txt',content:'B'}},{op:'create_file',args:{path:'parallel/c.txt',content:'C'}}]});
out.job=await tool('gjm_job_start',{projectRoot:root,type:'validate',payload:{}}); for(let i=0;i<50;i++){out.jobStatus=await tool('gjm_job_status',{jobId:out.job.job.id}); if(['completed','failed','cancelled'].includes(out.jobStatus.job?.status)) break; await new Promise(r=>setTimeout(r,100));}
console.log(JSON.stringify(out,null,2)); proc.kill('SIGTERM');
