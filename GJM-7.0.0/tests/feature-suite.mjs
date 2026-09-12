import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { writeText } from '../dist/src/fs-safe.js';
import { generateModel, generateRig, generateAnimation, createShader, importAudio, configureInput, scaffoldNetwork, performParallel, startJob, getJob } from '../dist/src/game-studio.js';
import { createServer } from '../dist/src/server.js';
import { applyMake } from '../dist/src/make.js';
import { validateMake } from '../dist/src/validate.js';
import { validateGodotProject, getGodotMajor, runGodot } from '../dist/src/godot.js';

const root = '/mnt/data/gjm-6.1-feature-e2e';
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
await fs.writeFile(path.join(root,'project.godot'), '; GJM feature E2E\nconfig_version=4\n\n[application]\nconfig/name="GJM Feature E2E"\nrun/main_scene="res://main.tscn"\n', 'utf8');
await fs.writeFile(path.join(root,'main.tscn'), '[gd_scene format=2]\n\n[node name="Main" type="Node2D"]\n', 'utf8');

const results = {};
results.model = await generateModel(root, { kind:'cube', output:'models/test.obj', size:2, name:'TestCube' });
results.rig = await generateRig(root, { output:'rigs/test.rig.json', name:'TestRig' });
results.animation = await generateAnimation(root, { output:'animations/walk.gjm.animation.json', target:'Main', property:'position', tracks:[{time:0,value:[0,0]},{time:0.5,value:[10,0]},{time:1,value:[0,0]}] });
results.shader = await createShader(root, { type:'canvas_item', output:'shaders/test.shader', uniforms:[{name:'strength',type:'float',default:1}], code:'void fragment(){ COLOR = vec4(strength, 0.0, 1.0, 1.0); }' });
const wav = Buffer.alloc(44); wav.write('RIFF',0); wav.writeUInt32LE(36,4); wav.write('WAVE',8); wav.write('fmt ',12); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(0,40);
results.audio = await importAudio(root, { output:'audio/test.wav', base64:wav.toString('base64') });
results.input = await configureInput(root, { action:'jump', deadzone:0.2, events:[] });
results.network = await scaffoldNetwork(root, { mode:'enet', outputDir:'network', port:7788, maxClients:4 });

const parallel = await performParallel(['a','b','c','d'], 2, async (x) => { await new Promise(r=>setTimeout(r,20)); return x.toUpperCase(); });
results.parallel = parallel;
const job = startJob('validate', root, async () => validateGodotProject(root));
results.jobStarted = { id: job.id, status: job.status };
for (let i=0;i<100;i++) { await new Promise(r=>setTimeout(r,20)); const j=getJob(job.id); if (j && ['completed','failed','cancelled'].includes(j.status)) { results.jobFinal=j; break; } }
results.validation = await validateGodotProject(root);
console.log(JSON.stringify({root, results}, null, 2));
