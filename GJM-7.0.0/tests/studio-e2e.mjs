import fs from 'node:fs/promises';
import path from 'node:path';
import { applyMake } from '../dist/src/make.js';
import { validateMake, validateBehavior } from '../dist/src/validate.js';
import { getGodotMajor, validateGodotProject } from '../dist/src/godot.js';
import { generateAnimation, generateModel, generateRig, createShader, importAudio, configureInput, scaffoldNetwork, autoplay } from '../dist/src/game-studio.js';
import { exportMp4, locateFrames, locateCheckpoints } from '../dist/src/record.js';
import { collectArtifacts } from '../dist/src/artifacts.js';
const root='/mnt/data/gjm-6.1-studio-e2e'; await fs.rm(root,{recursive:true,force:true}); await fs.mkdir(root,{recursive:true});
const make={format:'godot.make',version:1,name:'GJM Studio E2E',actions:[
 {type:'directory',path:'scripts'},
 {type:'script',path:'scripts/main.gd',content:'extends Node2D\nfunc _ready():\n print("GAME_STARTED")\n $Start.connect("pressed", self, "_on_start")\nfunc _on_start():\n $Status.text="Started"\n print("BUTTON_PRESSED")\n'},
 {type:'scene',path:'main.tscn',script:'res://scripts/main.gd',root:{name:'Main',type:'Node2D'},nodes:[{name:'Status',type:'Label',properties:{text:'Menu'}},{name:'Start',type:'Button',properties:{text:'Play'}}]},
 {type:'project_setting',section:'application',key:'run/main_scene',value:'res://main.tscn'},
 {type:'project_setting',section:'display',key:'window/size/width',value:800},
 {type:'project_setting',section:'display',key:'window/size/height',value:450}
]};
const major=await getGodotMajor(); await applyMake(root,validateMake(make),false,major);
const wav=Buffer.alloc(44); wav.write('RIFF'); wav.write('WAVE',8); wav.write('fmt ',12); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(0,40);
const generated={}; generated.model=await generateModel(root,{kind:'uv_sphere',output:'models/player.obj',radius:0.5}); generated.rig=await generateRig(root,{output:'rigs/player.rig.json'}); generated.animation=await generateAnimation(root,{name:'idle',output:'animations/idle.gjm.animation.json',target:'Start',property:'position',tracks:[{time:0,value:[0,0]},{time:0.5,value:[0,4]},{time:1,value:[0,0]}]}); generated.shader=await createShader(root,{type:'canvas_item',output:'shaders/player.shader',uniforms:[{name:'strength',type:'float',default:1}],code:'void fragment(){ COLOR=vec4(strength,0.5,1.0,1.0); }'}); generated.audio=await importAudio(root,{output:'audio/test.wav',base64:wav.toString('base64')}); generated.input=await configureInput(root,{action:'jump',deadzone:0.2,events:[]}); generated.network=await scaffoldNetwork(root,{mode:'enet',outputDir:'network',port:7799,maxClients:8});
const validation=await validateGodotProject(root);
const behavior={format:'godot.behavior',version:1,name:'studio acceptance',actions:[{type:'wait',ms:500},{type:'screenshot',name:'before'},{type:'click',x:400,y:215,button:'left'},{type:'wait',ms:200},{type:'screenshot',name:'after'},{type:'inspect_node',path:'Start',label:'start'}],assertions:[{type:'checkpoint',name:'before'},{type:'checkpoint',name:'after'},{type:'stdout_contains',value:'GAME_STARTED'},{type:'stdout_contains',value:'BUTTON_PRESSED'},{type:'stderr_not_contains',value:'SCRIPT ERROR'},{type:'frames_min',value:5},{type:'node_exists',path:'Start'},{type:'node_property',path:'Start',property:'visible',equals:true},{type:'exit_code',value:0}],capture:{fps:30,width:800,height:450,outputName:'studio-e2e.mp4'}};
const auto=await autoplay(root,{behavior:JSON.stringify(behavior),runs:2,stopOnFailure:true}); const video=await exportMp4(root,'studio-e2e.mp4',30); const frames=await locateFrames(root); const checkpoints=await locateCheckpoints(root); const artifacts=await collectArtifacts(root);
await fs.writeFile(path.join(root,'VERIFICATION.json'),JSON.stringify({major,generated,validation:{code:validation.code,stdout:validation.stdout,stderr:validation.stderr},autoplay,video,frames:frames.length,checkpoints:checkpoints.map(p=>path.relative(root,p)),artifactCount:artifacts.length},null,2));
console.log(JSON.stringify({major,generated,validation:validation.code,autoplayPassed:auto.passed,autoplayRuns:auto.runs,videoOk:video.ok,frames:frames.length,checkpoints:checkpoints.length,artifactCount:artifacts.length},null,2));
