import { readFile } from 'node:fs/promises';
const key=(await readFile(new URL('../.data/human-key',import.meta.url),'utf8')).trim();
console.log(`http://127.0.0.1:${process.env.PORT||4317}/#key=${key}`);
