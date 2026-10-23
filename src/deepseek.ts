type Message = { role: 'system' | 'user'; content: string };

export async function deepseekJSON(messages: Message[], maxTokens: number, timeoutMs: number): Promise<unknown> {
  const key=process.env.DEEPSEEK_API_KEY?.trim();
  if(!key)throw new Error('کلید DeepSeek در محیط برنامه تنظیم نشده است.');
  const base=new URL(process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com');
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new Error('آدرس مدل باید HTTPS و بدون اطلاعات ورود باشد.');
  const path=base.pathname.replace(/\/+$/,'');
  const endpoint=new URL(path.endsWith('/chat/completions')?path:`${path}/chat/completions`,base.origin);
  const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.DEEPSEEK_MODEL||'deepseek-chat',messages,response_format:{type:'json_object'},max_tokens:maxTokens,stream:false}),signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
  if(!response.ok)throw new Error(`مدل DeepSeek پاسخ نداد (HTTP ${response.status}).`);
  const body=await response.json() as {choices?:Array<{finish_reason?:string;message?:{content?:string|null}}>};
  const choice=body.choices?.[0];
  if(!choice?.message?.content)throw new Error('پاسخ مدل DeepSeek خالی بود.');
  if(choice.finish_reason==='length')throw new Error('پاسخ مدل DeepSeek کامل نشد؛ دوباره درخواست کنید.');
  try{return JSON.parse(choice.message.content);}catch{throw new Error('پاسخ مدل DeepSeek با قالب JSON سازگار نبود.');}
}
