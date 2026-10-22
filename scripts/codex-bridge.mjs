#!/usr/bin/env node
import { spawn } from 'node:child_process';
const args=process.argv.slice(2);
if(args[0]==='exec')args.splice(1,0,'--ignore-user-config','--ignore-rules','--ephemeral');
const child=spawn('codex',args,{stdio:'inherit',env:process.env});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>{console.error('Codex runtime is not available.');process.exit(1);});
child.on('exit',code=>process.exit(code??1));
