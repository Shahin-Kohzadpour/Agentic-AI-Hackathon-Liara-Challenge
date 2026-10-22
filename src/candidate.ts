import ts from 'typescript';

// A deliberately narrow pure-function contract for the registered sample, not a general JS sandbox.
export function validateCandidate(code:string){
  const source=ts.createSourceFile('summary.mjs',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(source.statements.length!==1||!ts.isFunctionDeclaration(source.statements[0])||source.statements[0].name?.text!=='summarizeOrder')throw new Error('اصلاح باید فقط تابع ثبت‌شدهٔ summarizeOrder را تعریف کند.');
  const allowedGlobals=new Set(['undefined','Number','Array','Math','String','Boolean']);
  const safeCallees=new Set(['Number','String','Boolean']);
  const declarations=new Set(['summarizeOrder']);
  const blocked=new Set(['constructor','prototype','__proto__','process','globalThis','global','eval','Function','require','Buffer','WebAssembly','fetch','module','exports','Deno','Bun','window','document','navigator','location','localStorage','indexedDB','XMLHttpRequest','WebSocket','Worker','importScripts','fs','child_process','worker_threads','http','https','net','dns','os','path','vm','cluster','tls','dgram']);
  // Pure read-only methods a minimal repair may legitimately use. Calls outside this set are rejected,
  // but the set is intentionally broader than the original seven-case implementation.
  const methods=new Set([
    'isArray','isInteger','isSafeInteger','isFinite','isNaN','parseInt','parseFloat',
    'some','every','reduce','map','filter','find','findIndex','includes','indexOf','join','slice','concat','flat','at','keys','values','entries',
    'max','min','round','floor','ceil','abs','trunc','sign','pow','sqrt',
    'trim','toLowerCase','toUpperCase','startsWith','endsWith','split','replace','toString','valueOf','toFixed',
  ]);
  function collect(node:ts.Node){if((ts.isVariableDeclaration(node)||ts.isParameter(node))&&ts.isIdentifier(node.name))declarations.add(node.name.text);ts.forEachChild(node,collect);}
  collect(source);
  function visit(node:ts.Node){
    if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)||ts.isImportEqualsDeclaration(node)||ts.isNewExpression(node)||ts.isElementAccessExpression(node)||ts.isWhileStatement(node)||ts.isDoStatement(node)||ts.isForStatement(node)||ts.isForInStatement(node)||ts.isForOfStatement(node)||ts.isTaggedTemplateExpression(node)||node.kind===ts.SyntaxKind.ThisKeyword||ts.isAwaitExpression(node)||ts.isYieldExpression(node))throw new Error('اصلاح از محدودهٔ تابع خالص نمونه خارج است.');
    if(ts.isIdentifier(node)){
      if(blocked.has(node.text))throw new Error('دسترسی غیرمجاز در اصلاح پیشنهادی.');
      const isProperty=(ts.isPropertyAccessExpression(node.parent)&&node.parent.name===node)||(ts.isPropertyAssignment(node.parent)&&node.parent.name===node);
      if(!isProperty&&!declarations.has(node.text)&&!allowedGlobals.has(node.text))throw new Error(`شناسهٔ خارج از قرارداد تابع: ${node.text}`);
    }
    if(ts.isCallExpression(node)){
      const callee=node.expression;
      const allowed=(ts.isPropertyAccessExpression(callee)&&methods.has(callee.name.text))||(ts.isIdentifier(callee)&&safeCallees.has(callee.text));
      if(!allowed)throw new Error(`فراخوانی خارج از قرارداد تابع نمونه مجاز نیست: ${callee.getText(source).slice(0,80)}`);
    }
    ts.forEachChild(node,visit);
  }
  visit(source);
}
