import ts from 'typescript';

// A deliberately narrow pure-function contract for the registered sample, not a general JS sandbox.
export function validateCandidate(code:string){
  const source=ts.createSourceFile('summary.mjs',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(source.statements.length!==1||!ts.isFunctionDeclaration(source.statements[0])||source.statements[0].name?.text!=='summarizeOrder')throw new Error('اصلاح باید فقط تابع ثبت‌شدهٔ summarizeOrder را تعریف کند.');
  const allowedGlobals=new Set(['undefined','Number','Array','Math']);
  const declarations=new Set(['summarizeOrder']);
  const blocked=new Set(['constructor','prototype','__proto__','process','globalThis','global','eval','Function','require','Buffer','WebAssembly','fetch']);
  const methods=new Set(['isArray','isInteger','some','reduce','max','min','round','floor','ceil']);
  function collect(node:ts.Node){if((ts.isVariableDeclaration(node)||ts.isParameter(node))&&ts.isIdentifier(node.name))declarations.add(node.name.text);ts.forEachChild(node,collect);}
  collect(source);
  function visit(node:ts.Node){
    if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)||ts.isImportEqualsDeclaration(node)||ts.isNewExpression(node)||ts.isElementAccessExpression(node)||ts.isWhileStatement(node)||ts.isDoStatement(node)||ts.isForStatement(node)||ts.isForInStatement(node)||ts.isForOfStatement(node)||node.kind===ts.SyntaxKind.ThisKeyword||ts.isAwaitExpression(node)||ts.isYieldExpression(node))throw new Error('اصلاح از محدودهٔ تابع خالص نمونه خارج است.');
    if(ts.isIdentifier(node)){
      if(blocked.has(node.text))throw new Error('دسترسی غیرمجاز در اصلاح پیشنهادی.');
      const isProperty=(ts.isPropertyAccessExpression(node.parent)&&node.parent.name===node)||(ts.isPropertyAssignment(node.parent)&&node.parent.name===node);
      if(!isProperty&&!declarations.has(node.text)&&!allowedGlobals.has(node.text))throw new Error(`شناسهٔ خارج از قرارداد تابع: ${node.text}`);
    }
    if(ts.isCallExpression(node)&&(!ts.isPropertyAccessExpression(node.expression)||!methods.has(node.expression.name.text)))throw new Error('فراخوانی خارج از قرارداد تابع نمونه مجاز نیست.');
    ts.forEachChild(node,visit);
  }
  visit(source);
}
