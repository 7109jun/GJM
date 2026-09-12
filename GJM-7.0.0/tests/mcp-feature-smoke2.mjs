import {spawn} from 'node:child_process'; import fs from 'node:fs/promises'; import path from 'node:path';
const root='/mnt/data/gjm-6.1-mcp-feature2'; await fs.rm(root,{recursive:true,force:true}); await fs.mkdir(root,{recursive:true}); await fs.writeFile(path.join(root,'project.godot'),'config_version=4\n\n[application]\nconfig/name="GJM Feature2"\nrun/main_scene="res://main.tscn"\n','utf8'); await fs.writeFile(path.join(root,'main.tscn'),'[gd_scene format=2]\n\n[node name="Main" type="Node2D"]\n','utf8');
const p=spawn(process.execPath,['dist/src/index.js'],{cwd:'/mnt/data/Godot-J-MCP-6.1.0',env:{...process.env,TERM:'xterm',GODOT_BIN:'/mnt/data/godot-real/Godot_v3.6.3-stable_mono_x11_64/Godot_v3.6.3-stable_mono_x11.64'},stdio:['pipe','pipe','pipe']});
p.stderr.on('data',d=>process.stderr.write('[ERR]'+d)); let buf=''; const pending=new Map(); p.stdout.on('data',d=>{buf+=d.toString(); while(true){const i=buf.indexOf('\n'); if(i<0)break; const line=buf.slice(0,i); buf=buf.slice(i+1); if(!line.trim())continue; const m=JSON.parse(line); const fn=pending.get(m.id); if(fn){pending.delete(m.id); fn(m);}}}); let id=0;
const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id; pending.set(n,(m)=>m.error?reject(new Error(m.error.message)):resolve(m.result)); p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n'); setTimeout(()=>{if(pending.has(n)){pending.delete(n);reject(new Error('timeout '+method));}},12000)});
console.log((await call('initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'smoke',version:'1'}})).serverInfo); p.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n');
for (const [name,args] of [
 ['gjm_model',{projectRoot:root,kind:'cube',output:'models/cube.obj'}],
 ['gjm_rig',{projectRoot:root,output:'rigs/rig.json'}],
 ['gjm_animation',{projectRoot:root,output:'animations/walk.gjm.animation.json'}],
 ['gjm_shader',{projectRoot:root,output:'shaders/test.shader'}],
 ['gjm_audio',{projectRoot:root,output:'audio/test.wav',base64:Buffer.from('RIFFxxxxWAVE').toString('base64')}],
 ['gjm_input',{projectRoot:root,action:'jump',events:[]}],
 ['gjm_network',{projectRoot:root,mode:'enet'}],
 ['gjm_parallel',{projectRoot:root,maxConcurrency:2,jobs:[{op:'create_file',args:{path:'parallel/a.txt',content:'A'}},{op:'create_file',args:{path:'parallel/b.txt',content:'B'}},{op:'create_file',args:{path:'parallel/c.txt',content:'C'}}]}],
 ['gjm_studio',{projectRoot:root,snapshot:false,spec:{validate:false,models:[{kind:'plane',output:'models/plane.obj'}],shaders:[{output:'shaders/s2.shader'}]}}],
 ['gjm_job_start',{projectRoot:root,type:'studio',payload:{spec:{validate:false,models:[{kind:'pyramid',output:'models/job.obj'}]}}}]
]) { const r=await call('tools/call',{name,arguments:args}); console.log(name, JSON.stringify(r).slice(0,500)); if(name==='gjm_job_start'){const job=JSON.parse(r.content[0].text); for(let i=0;i<50;i++){const s=await call('tools/call',{name:'gjm_job_status',arguments:{jobId:job.id}}); const j=JSON.parse(s.content[0].text).job; if(['completed','failed','cancelled'].includes(j?.status)){console.log('job-final',j.status);break;} await new Promise(r=>setTimeout(r,50));}} }
p.kill('SIGTERM');
