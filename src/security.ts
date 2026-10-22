import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const id = (prefix:string) => `${prefix}_${randomBytes(8).toString('hex')}`;
export const sha256 = (value:string|Buffer) => createHash('sha256').update(value).digest('hex');
export function equals(a:string,b:string) { const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); }
export function redact(value:unknown):unknown {
  if (typeof value==='string') {
    let s=value;
    for(const [k,v] of Object.entries(process.env)) if(v && v.length>8 && /TOKEN|API_KEY|SECRET|PASSWORD/.test(k)) s=s.split(v).join('[REDACTED]');
    return s.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[REDACTED]')
      .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g,'[REDACTED]').slice(0,24000);
  }
  if(Array.isArray(value)) return value.slice(-80).map(redact);
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).filter(([k])=>!['envs','variables','headers','authorization','access_token','refresh_token'].includes(k.toLowerCase())).map(([k,v])=>[k,/password|secret|api.?key|token/i.test(k)?'[REDACTED]':redact(v)]));
  return value;
}
export const messageOf=(e:unknown)=>String(redact(e instanceof Error?e.message:String(e)));
export function validProject(name:string) { if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(name)) throw new Error('شناسهٔ پروژه معتبر نیست.'); return name; }
