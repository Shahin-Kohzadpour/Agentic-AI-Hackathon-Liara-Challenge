import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { Core } from '../src/core.ts';
import { id } from '../src/security.ts';

const root=resolve(import.meta.dirname,'..'),core=new Core(root);await core.initialize();
const file=join(root,'.data','provision-plan.json');
if(!process.argv.includes('--apply')){
  const me=await core.liara.request('/v1/me');const plan=me.plans.projects['small-g2'],bundle=me.plans.projectBundlePlans['small-g2'].basic;
  if(!plan.available||!bundle.available)throw new Error('Selected plan is unavailable.');
  const p=core.project('local'),snapshot=await core.snapshots.assertIntact(p.currentSnapshot);
  const proposal={name:`negahban-demo-${id('app').slice(-6)}`,teamId:process.env.LIARA_TEAM_ID,planId:'small-g2',bundlePlanId:'basic',ramGB:plan.RAM.amount,cpu:plan.CPU.amount,estimatedMonthlyTomans:Math.round(plan.price*720+bundle.displayPrice),estimatedHourlyTomans:Math.round((plan.price+bundle.price)*100)/100,snapshotId:snapshot.id,sourceDigest:snapshot.digest,createdAt:new Date().toISOString(),purpose:'Disposable hackathon sample, deliberately reproduces an order-summary error. Creates its own network and app, then deploys the prepared source. Existing resources are untouched.'};
  await writeFile(file,JSON.stringify(proposal,null,2),{mode:0o600});console.log(JSON.stringify(proposal,null,2));
}else{
  const plan=JSON.parse(await readFile(file,'utf8'));
  if(plan.teamId!==process.env.LIARA_TEAM_ID)throw new Error('Team configuration changed.');
  await core.snapshots.assertIntact(plan.snapshotId);
  const projects=await core.liara.request('/v1/projects');
  if(projects.projects.some((p:any)=>p.project_id===plan.name))throw new Error('App already exists; inspect it before retrying provisioning.');
  let networks=await core.liara.request('/v1/networks');
  let network=networks.networks.find((n:any)=>n.name===plan.name||n.networkName===plan.name);
  if(!network){await core.liara.request('/v1/networks','POST',{networkName:plan.name});networks=await core.liara.request('/v1/networks');network=networks.networks.find((n:any)=>n.name===plan.name||n.networkName===plan.name);}
  if(!network)throw new Error('Network creation requires reconciliation; do not retry blindly.');
  await core.liara.request('/v1/projects/','POST',{name:plan.name,planID:plan.planId,bundlePlanID:plan.bundlePlanId,platform:'node',network:network._id,readOnlyRootFilesystem:true});
  const project={id:'liara',name:plan.name,mode:'liara' as const,currentSnapshot:plan.snapshotId,revision:0};core.store.put('projects',project);
  const envPath=join(root,'.env');let env=await readFile(envPath,'utf8');env=env.split('\n').filter(l=>!l.startsWith('LIARA_PROJECT=')).join('\n').trim()+`\nLIARA_PROJECT=${plan.name}\n`;await writeFile(envPath,env,{mode:0o600});process.env.LIARA_PROJECT=plan.name;
  const a=await core.prepareAction('liara','deploy');
  // This command is run only after approval of the saved provisioning proposal.
  core.decide(a.id,'approve');const result=await core.execute(a.id);
  await mkdir(join(root,'artifacts'),{recursive:true});await writeFile(join(root,'artifacts','initial-deployment.json'),JSON.stringify({proposal:plan,action:result},null,2));
  console.log(JSON.stringify({status:result.status,project:plan.name,release:core.project('liara').remoteRelease,verification:(result.result as any)?.verification,url:core.liara.appUrl(plan.name)},null,2));
}
