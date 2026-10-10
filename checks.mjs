import {readdir,readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
const walk=async path=>(await Promise.all((await readdir(path,{withFileTypes:true})).map(e=>e.isDirectory()?walk(path+'/'+e.name):[path+'/'+e.name]))).flat();
const files=await walk('dist');
for(const path of files.filter(f=>f.endsWith('.js'))){const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});if(result.status){process.stderr.write(result.stderr);process.exit(1);}const text=await readFile(path,'utf8');for(const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)){const target=resolve(dirname(path),match[1]);try{await readFile(target);}catch{throw new Error(`Missing local import ${match[1]} in ${path}`)}}}
const html=await readFile('dist/index.html','utf8');for(const match of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)){try{await readFile(resolve('dist',match[1]));}catch{throw new Error(`Missing HTML asset ${match[1]}`)}}
console.log('JavaScript syntax and local module/HTML assets verified.');
