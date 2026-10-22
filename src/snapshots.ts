import { readFile,writeFile,mkdir,readdir,lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256,id } from './security.ts';
import type { Snapshot } from './types.ts';
import { Store } from './store.ts';

export class Snapshots {
  constructor(private root:string,private store:Store){}
  path(snapshotId:string) {if(!/^src_[a-f0-9]{16}$/.test(snapshotId))throw new Error('منبع نامعتبر');return join(this.root,snapshotId);}
  digest(files:Record<string,string>) {return sha256(JSON.stringify(Object.entries(files).sort(([a],[b])=>a.localeCompare(b))));}
  async create(files:Record<string,string>):Promise<Snapshot> {
    const expected=['summary.mjs','server.mjs','package.json','liara.json'];
    if(Object.keys(files).length!==expected.length||expected.some(f=>typeof files[f]!=='string'))throw new Error('مجموعه فایل‌های منبع معتبر نیست.');
    const snapshot:Snapshot={id:id('src'),digest:this.digest(files),files,createdAt:new Date().toISOString()};
    await mkdir(this.path(snapshot.id),{recursive:true,mode:0o700});
    // Deployment archives must remain readable by the platform's non-root runtime user.
    for(const [name,content]of Object.entries(files))await writeFile(join(this.path(snapshot.id),name),content,{mode:0o444});
    this.store.put('snapshots',snapshot);return snapshot;
  }
  async seed(fixture:string) {
    const files:Record<string,string>={};
    for(const name of ['summary.mjs','server.mjs','package.json','liara.json']) files[name]=await readFile(join(fixture,name),'utf8');
    return this.create(files);
  }
  get(snapshotId:string) {const s=this.store.get<Snapshot>('snapshots',snapshotId);if(!s)throw new Error('منبع پیدا نشد.');return s;}
  async assertIntact(snapshotId:string) {
    const s=this.get(snapshotId),disk:Record<string,string>={};
    const names=await readdir(this.path(snapshotId));
    if(names.length!==Object.keys(s.files).length)throw new Error('منبع انتشار پس از آماده‌سازی تغییر کرده است.');
    for(const name of names){const p=join(this.path(snapshotId),name);if(!(await lstat(p)).isFile())throw new Error('فایل غیرمجاز در منبع انتشار.');disk[name]=await readFile(p,'utf8');}
    if(this.digest(disk)!==s.digest)throw new Error('منبع انتشار پس از آماده‌سازی تغییر کرده است.');return s;
  }
}
