import { summarizeOrder } from '/app/summary.mjs';
try { console.log(JSON.stringify(summarizeOrder(JSON.parse(process.argv[2])))); }
catch(e) { console.log(JSON.stringify({status:500,body:{error:'INTERNAL_ERROR'},exception:String(e.stack)})); }
