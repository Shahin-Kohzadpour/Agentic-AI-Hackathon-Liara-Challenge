import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const key=(await readFile(new URL('../.data/mcp-key',import.meta.url),'utf8')).trim();
const port=Number(process.env.PORT||4317);
async function call(name:string,args:unknown){
  const r=await fetch(`http://127.0.0.1:${port}/api/tools`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({name,args}),signal:AbortSignal.timeout(300000)});
  const body=await r.json();return {content:[{type:'text' as const,text:JSON.stringify(body)}],isError:!r.ok};
}
const server=new McpServer({name:'negahban-liara',version:'0.1.0'},{instructions:'Inspect only registered projects. All mutations require an immutable action plan and a human approval in the private dashboard. This server cannot grant approvals. Local rehearsal and live Liara operations are distinct. Never claim recovery from a health check alone.'});
server.registerTool('liara_projects',{description:'List registered local and Liara projects; no secret values.',inputSchema:{},annotations:{readOnlyHint:true}},()=>call('projects',{}));
server.registerTool('liara_diagnostics',{description:'Collect sanitized logs, events, releases, and resource evidence with timestamps and limitations.',inputSchema:{projectId:z.string()},annotations:{readOnlyHint:true}},args=>call('diagnostics',args));
server.registerTool('incident_start',{description:'Investigate and prepare a code repair for the registered sample. Does not deploy; human approval is required.',inputSchema:{projectId:z.string(),request:z.string().min(5).max(2000)}},args=>call('incident_start',args));
server.registerTool('deployment_prepare',{description:'Prepare a source-bound deployment or restart plan without changing the service.',inputSchema:{projectId:z.string(),kind:z.enum(['deploy','restart'])}},args=>call('action_prepare',args));
server.registerTool('deployment_apply',{description:'Execute a stored action ONLY if a human has already approved it in the dashboard. Cannot approve or change the plan.',inputSchema:{actionId:z.string()},annotations:{destructiveHint:true,idempotentHint:true}},args=>call('action_execute',args));
server.registerTool('incident_report',{description:'Read incident evidence, independent test results, diagnosis, and recovery status.',inputSchema:{runId:z.string()},annotations:{readOnlyHint:true}},args=>call('report',args));
await server.connect(new StdioServerTransport());
