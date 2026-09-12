import fs from 'node:fs/promises';
import path from 'node:path';
import { safeProjectPath, normalizeProjectRoot } from './fs-safe.js';

const EXCLUDED = new Set(['.git','.godot','.gjm_snapshots','.gjm_frames','.gjm_history','.gjm_tasks']);
const EXTENSIONS = new Set(['.gd','.tscn','.tres','.shader','.gdshader','.cs','.json']);

async function files(root: string, dir: string, out: string[]) {
  for (const e of await fs.readdir(dir, {withFileTypes:true})) {
    if (EXCLUDED.has(e.name)) continue;
    const abs = path.join(dir,e.name);
    if (e.isDirectory()) await files(root,abs,out);
    else if (e.isFile() && EXTENSIONS.has(path.extname(e.name).toLowerCase())) out.push(path.relative(root,abs).replaceAll(path.sep,'/'));
  }
}

export async function buildDependencyGraph(projectRoot: string, options: {maxFiles?: number} = {}) {
  const root = normalizeProjectRoot(projectRoot);
  const all:string[]=[]; await files(root,root,all); all.sort();
  const selected=all.slice(0, options.maxFiles ?? 2000);
  const nodes: Array<{id:string; type:string; className?:string; extends?:string}> = selected.map((p)=>({id:p,type:path.extname(p).slice(1)||'file'}));
  const edges:{from:string;to:string;kind:string}[]=[];
  const selectedSet=new Set(selected);
  const byBase=new Map<string,string>();
  for (const p of selected) byBase.set(path.basename(p).replace(path.extname(p),''), p);
  for (const p of selected) {
    const text=await fs.readFile(safeProjectPath(root,p),'utf8').catch(()=> '');
    const refs=new Set<string>();
    const re=/(?:res:\/\/)?([A-Za-z0-9_./-]+\.(?:gd|tscn|tres|shader|gdshader|cs|json))/g;
    let m:RegExpExecArray|null;
    while((m=re.exec(text))) refs.add(m[1].replaceAll('\\','/'));
    for (const ref of refs) {
      let target=ref;
      if (!selectedSet.has(target)) {
        const base=path.basename(target).replace(path.extname(target),'');
        target=byBase.get(base) ?? '';
      }
      if (target && selectedSet.has(target) && target!==p) edges.push({from:p,to:target,kind:'reference'});
    }
    if (p.endsWith('.gd')) {
      const cls=text.match(/^class_name\s+([A-Za-z_][A-Za-z0-9_]*)/m)?.[1];
      const ext=text.match(/^extends\s+(.+)$/m)?.[1]?.trim();
      if (cls) nodes.find(n=>n.id===p)!.className=cls;
      if (ext) nodes.find(n=>n.id===p)!.extends=ext;
    }
  }
  return {ok:true,nodeCount:nodes.length,edgeCount:edges.length,truncated:all.length>selected.length,nodes,edges};
}
