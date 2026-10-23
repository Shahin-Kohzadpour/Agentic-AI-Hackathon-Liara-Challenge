import { readFile } from 'node:fs/promises';
const hosted=process.argv.includes('--liara');
const keyFile=hosted?'../.data/liara-dashboard-key':'../.data/human-key';
const key=(await readFile(new URL(keyFile,import.meta.url),'utf8')).trim();
let origin=`http://127.0.0.1:${process.env.PORT||4317}`;
if(hosted){
  const config=JSON.parse(await readFile(new URL('../liara.json',import.meta.url),'utf8')) as {app:string};
  origin=`https://${config.app}.liara.run`;
}
console.log(`${origin}/#key=${encodeURIComponent(key)}`);
