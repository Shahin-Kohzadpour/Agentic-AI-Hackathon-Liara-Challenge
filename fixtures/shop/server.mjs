import http from 'node:http';
import { summarizeOrder } from './summary.mjs';
const send=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
const server=http.createServer(async(req,res)=>{
  if(req.url==='/healthz') return send(res,200,{status:'ok',version:process.env.APP_VERSION||'demo'});
  if(req.url==='/version') return send(res,200,{version:process.env.APP_VERSION||'demo'});
  if(req.url==='/api/summary' && req.method==='POST') {
    let raw='';
    try {
      for await(const chunk of req){raw+=chunk;if(raw.length>16000)return send(res,413,{error:'TOO_LARGE'});}
      let order;
      // Malformed or empty JSON is a client error, not a runtime failure.
      try{order=JSON.parse(raw);}catch{return send(res,400,{error:'INVALID_JSON'});}
      const result=summarizeOrder(order); return send(res,result.status,result.body);
    } catch(error) {
      console.error(JSON.stringify({event:'order_summary_failed',message:error.message,stack:error.stack}));
      return send(res,500,{error:'INTERNAL_ERROR'});
    }
  }
  send(res,404,{error:'NOT_FOUND'});
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0');
