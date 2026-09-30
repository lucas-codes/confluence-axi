import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../index.ts';
import { request, ORIGIN } from '../api.ts';
import { spawnSync } from 'node:child_process';

const env = { ATLASSIAN_EMAIL: 'reader@example.com', ATLASSIAN_API_TOKEN: 'DUMMY_SECRET', JIRA_API_TOKEN: 'FALLBACK_SECRET' };
const basic = Buffer.from(`${env.ATLASSIAN_EMAIL}:${env.ATLASSIAN_API_TOKEN}`).toString('base64');
const doc = (content: unknown[] = []) => JSON.stringify({ type: 'doc', version: 1, content });
const page = { id: '123', title: 'A page', version: { number: 2, createdAt: 'today' }, body: { atlas_doc_format: { value: doc([{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }]) } } };
async function run(args: string[], data: unknown = {}, status = 200, headers: Record<string,string> = {}) {
  const calls: { url: string; init: RequestInit | undefined }[] = []; let output = '';
  const exit = await main(args, { env, fetch: async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } }); }, write: s => { output += s; } });
  return { exit, output, calls, value: args.includes('--json') && output.startsWith('{') ? JSON.parse(output) : undefined };
}

test('every read command uses one authenticated GET and normalized schema', async () => {
  const cases: [string[],unknown,string,string][] = [
    [[], {type:'known', accountId:'abc',displayName:'Reader'}, '/wiki/rest/api/user/current', 'auth'],
    [['status'], {type:'user',accountId:'abc'}, '/wiki/rest/api/user/current', 'auth'],
    [['search','-q','type=page'], {results:[{content:{id:'123'},entityType:'content',title:'Found'}],totalSize:1}, '/wiki/rest/api/search', 'results'],
    [['spaces'], {results:[{id:'1',name:'Engineering'}]}, '/wiki/api/v2/spaces', 'spaces'],
    [['page','123'], page, '/wiki/api/v2/pages/123', 'body'],
    [['children','123'], {results:[{id:'2',type:'page',childPosition:0},{id:'3',type:'folder'}]}, '/wiki/api/v2/pages/123/direct-children', 'children'],
    [['attachments','123'], {results:[{id:'att1',title:'File',fileSize:5,version:{number:1},downloadLink:'https://evil.test/file'}]}, '/wiki/api/v2/pages/123/attachments', 'attachments'],
    [['labels','123'], {results:[{id:'1',name:'tag',prefix:'global'}]}, '/wiki/api/v2/pages/123/labels', 'labels'],
  ];
  for (const [args,data,path,field] of cases) {
    const r = await run([...args,'--json'],data); assert.equal(r.exit,0,r.output); assert.ok(field in r.value);
    assert.equal(r.calls.length,1); assert.equal(new URL(r.calls[0]!.url).pathname,path);
    assert.equal(r.calls[0]!.init?.method,'GET'); assert.equal(r.calls[0]!.init?.redirect,'manual');
    assert.equal((r.calls[0]!.init?.headers as Record<string,string>).Authorization,`Basic ${basic}`);
    assert.ok(!r.output.includes('downloadLink')); assert.ok(!r.output.includes('evil.test'));
    if(field==='body') assert.equal(new URL(r.calls[0]!.url).searchParams.get('body-format'),'atlas_doc_format');
    if(field==='children') assert.equal(r.value.count,1);
  }
});

test('strict parser rejects misuse before fetch, including diagnostic invocations', async () => {
  for(const args of [ ['unknown','--help'],['page','nope','--help'],['page','123','--limit','2','--help'], ['page','0'],['page','01'],['page','9223372036854775808'],['page','+2'],['page','1.2'],['page','123','extra'],['search','--cql',''],['search'],['spaces','--limit','101'],['spaces','--limit','0'],['spaces','--limit','1.2'],['spaces','--limit'],['spaces','--limit','2','--limit','3'],['status','--full'],['page','123','--full','--max-chars','100'],['--help','--version'],['--json=true'],['status','--site','evil.test'],['--help','-h'],['raw'],['login'],['page','123','--max-chars','20001'] ]) {
    const r=await run([...args,'--json']); assert.equal(r.exit,2,JSON.stringify(args)); assert.equal(r.calls.length,0); assert.equal(r.value.code,'usage');
  }
  for(const args of [['page','--help'],['search','--help'],['--version'],['help','--json']]) { const r=await run(args); assert.equal(r.exit,0); assert.equal(r.calls.length,0); }
});

test('origin, protocol, port, userinfo and path are rejected with zero fetch calls', async () => {
  let calls=0;
  for(const url of ['https://evil.test/wiki/api/v2/spaces','http://einc.atlassian.net/wiki/api/v2/spaces',`${ORIGIN}:444/wiki/api/v2/spaces`,'https://x@einc.atlassian.net/wiki/api/v2/spaces',`${ORIGIN}/wiki/download/file`,`${ORIGIN}/wiki/api/v2/pages/123/labels#bad`,`${ORIGIN}/wiki/api/v2/spaces#`,'https://@einc.atlassian.net/wiki/api/v2/spaces',`${ORIGIN}/wiki/api/v2/spa\nces`]) {
    await assert.rejects(request(url, basic, async () => { calls++; return new Response('{}'); }), { code: 'security' });
  }
  assert.equal(calls,0);
});

test('redirect sends credentials only to initial allowed origin, never follows', async () => {
  for(const status of [301,302,303,307,308]) { const r=await run(['spaces','--json'],{},status,{location:'https://evil.test'}); assert.equal(r.exit,1); assert.equal(r.value.code,'security'); assert.equal(r.calls.length,1); }
});

test('crafted next links fail after exactly one allowed-origin call', async () => {
  for(const next of ['https://evil.test/wiki/api/v2/spaces?cursor=x','http://einc.atlassian.net/wiki/api/v2/spaces?cursor=x','/wiki/download/file?cursor=x','/wiki/api/v2/pages/2/labels?cursor=x','/wiki/api/v2/spaces','/wiki/api/v2/spaces?cursor=x#fragment','https://x@einc.atlassian.net/wiki/api/v2/spaces?cursor=x']) {
    const r=await run(['spaces','--json'],{results:[],_links:{next}}); assert.equal(r.exit,1,next); assert.equal(r.calls.length,1);
  }
  const r=await run(['spaces','--json'],{results:[],_links:{next:'/wiki/api/v2/spaces?cursor=a'}},200,{Link:'</wiki/api/v2/spaces?cursor=b>; rel="next"'}); assert.equal(r.value.code,'bad_response');
});

test('cursor round trip remains opaque, long, bounded and one-page only', async () => {
  const cursor='abc'.repeat(100); const r=await run(['search','-q','hello','--json'],{results:[],_links:{next:`/rest/api/search?cursor=${cursor}`}}); assert.equal(r.exit,0); assert.equal(r.value.nextCursor,cursor); assert.equal(r.calls.length,1);
  const next=await run(['search','-q','hello','--cursor',r.value.nextCursor,'--json'],{results:[]}); assert.equal(new URL(next.calls[0]!.url).searchParams.get('cursor'),cursor);
  for(const cursor of ['x'.repeat(8193),'unsafe\u009b','DUMMY_SECRET','DUMMY_\x1b[31mSECRET',basic]) {
    const a=await run(['spaces','--cursor',cursor,'--json'],{results:[]}); assert.equal(a.exit,2); assert.equal(a.calls.length,0);
    const b=await run(['spaces','--json'],{results:[],_links:{next:`/wiki/api/v2/spaces?cursor=${encodeURIComponent(cursor)}`}}); assert.equal(b.value.code,'bad_response');
  }
});

test('sanitization and double redaction protect every string field in JSON and TOON', async () => {
  const dirty='A\u009b31mB\x1b[31mC\x1b]0;evil\x07D\0\x7f';
  const secret='DUMMY_\x1b[31mSECRET FALLBACK_SECRET '+basic;
  for(const json of [false,true]) {
    for(const [args,data] of [ [['spaces'],{results:[{name:dirty,key:secret}]}], [['labels','123'],{results:[{name:dirty,prefix:secret}]}], [['attachments','123'],{results:[{title:dirty,mediaType:secret}]}], [['page','123'],{...page,title:dirty,body:{atlas_doc_format:{value:doc([{type:'text',text:dirty+'\n\t'+secret}])}}}], [['status'],{type:'known',accountId:dirty,displayName:secret}] ] as [string[],unknown][]) {
      const r=await run([...args,...(json?['--json']:[])],data); assert.equal(r.exit,0,r.output); assert.ok(!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(r.output));
      for(const s of [env.ATLASSIAN_API_TOKEN,env.JIRA_API_TOKEN,basic,'evil','31m']) assert.ok(!r.output.includes(s),r.output);
    }
    const r=await run(['DUMMY_\x1b[31mSECRET',...(json?['--json']:[])]); assert.equal(r.exit,2); assert.ok(!r.output.includes('DUMMY_SECRET'));
  }
});

test('HTTP errors and malformed JSON/shape never echo remote secrets', async () => {
  for(const [status,code] of [[401,'unauthorized'],[403,'forbidden'],[404,'not_found'],[429,'rate_limited'],[500,'http_error']] as const) { const r=await run(['spaces','--json'],{error:env.ATLASSIAN_API_TOKEN},status); assert.equal(r.value.code,code); assert.equal(r.exit,1); assert.ok(!r.output.includes(env.ATLASSIAN_API_TOKEN)); }
  for(const data of [null,[],{results:null},{results:[null]},{results:[{id:3}]},{results:[{name:4}]},{results:Array(31).fill({})}]) { const r=await run(['spaces','--json'],data); assert.equal(r.value.code,'bad_response'); }
  for(const data of [{type:'anonymous',accountId:'a'},{type:'known',accountId:''},{type:'user',accountId:2}]) assert.equal((await run(['status','--json'],data)).exit,1);
  for(const data of [{...page,id:'124'},{...page,version:{number:2.5}},{...page,body:{atlas_doc_format:{value:'{}'}}},{...page,body:{atlas_doc_format:{value:'null'}}},{...page,body:{atlas_doc_format:{value:'bad DUMMY_SECRET'}}}]) assert.equal((await run(['page','123','--json'],data)).exit,1);
  assert.equal((await run(['search','-q','a','--json'],{results:[{space:{id:9007199254740992}}]})).value.code,'bad_response');
});

test('transport, JSON parse, content type and response cap failures are bounded', async () => {
  for(const [fetch,code] of [ [async()=>{throw new Error(env.ATLASSIAN_API_TOKEN+basic);},'transport_error'], [async()=>new Response('bad DUMMY_SECRET',{headers:{'content-type':'application/json'}}),'bad_json'], [async()=>new Response('{}'),'bad_json'], [async()=>new Response('x'.repeat(5*1024*1024+1),{headers:{'content-type':'application/json'}}),'response_too_large'] ] as [typeof globalThis.fetch,string][]) {
    let output=''; const exit=await main(['spaces','--json'],{env,fetch,write:s=>{output+=s;}}); assert.equal(exit,1); assert.equal(JSON.parse(output).code,code); assert.ok(!output.includes(env.ATLASSIAN_API_TOKEN)); assert.ok(!output.includes(basic));
  }
});

test('credentials read per invocation, fallback and missing/invalid credentials', async () => {
  for(const e of [{}, {ATLASSIAN_EMAIL:env.ATLASSIAN_EMAIL}, {...env,ATLASSIAN_EMAIL:'bad:email'}, {...env,ATLASSIAN_API_TOKEN:'bad\n'}]) {
    let calls=0,out=''; const exit=await main(['status','--json'],{env:e,fetch:async()=>{calls++;throw Error();},write:s=>{out+=s;}}); assert.equal(exit,1); assert.equal(calls,0); assert.match(out,/token_missing|security/);
  }
  let authorization=''; const e={...env,ATLASSIAN_API_TOKEN:''}; const exit=await main(['status'],{env:e,fetch:async(_u,i)=>{authorization=(i?.headers as Record<string,string>).Authorization!;return Response.json({type:'known',accountId:'a'});},write:()=>{}}); assert.equal(exit,0); assert.equal(authorization,`Basic ${Buffer.from(`${e.ATLASSIAN_EMAIL}:${e.JIRA_API_TOKEN}`).toString('base64')}`);
});

test('Unicode limits, truncation disclosure and hard stdout cap apply to both formats', async () => {
  for(const json of [false,true]) {
    const r=await run(['page','123','--max-chars','3',...(json?['--json']:[])],{...page,title:'x'.repeat(91),body:{atlas_doc_format:{value:doc([{type:'text',text:'😀'.repeat(10)}])}}}); assert.equal(r.exit,0); assert.match(r.output,/bodyTruncated/); if(json){assert.equal(r.value.body,'😀😀😀');assert.equal(r.value.bodyLength,10);assert.equal(r.value.truncatedFields.title,91);}
    const large=await run(['search','-q','a','--full','--limit','100',...(json?['--json']:[])],{results:Array.from({length:100},()=>({title:'x'.repeat(1000),excerpt:'x'.repeat(1000),url:ORIGIN+'/'+ 'x'.repeat(1000),lastModified:'x'.repeat(1000),entityType:'x'.repeat(1000),content:{id:'x'.repeat(1000)}}))}); assert.equal(large.exit,1); assert.match(large.output,/output_too_large/); assert.ok(Buffer.byteLength(large.output)<512*1024);
  }
});

test('deadline spans fetch and body, with no retries', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const bodyHangs of [false, true]) {
    let output='',calls=0;
    const fetcher: typeof fetch = async () => {
      calls++;
      if (!bodyHangs) return await new Promise<Response>(() => {});
      return new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } });
    };
    const pending=main(['spaces','--json'],{env,fetch:fetcher,write:s=>{output+=s;}});
    await Promise.resolve();
    t.mock.timers.tick(30000);
    assert.equal(await pending,1); assert.equal(calls,1); assert.equal(JSON.parse(output).code,'transport_error');
  }
});

test('serialized leak check fails closed, even for secrets in structural keys', async () => {
  let output='';
  const exit=await main(['unknown','--json'],{env:{...env,ATLASSIAN_API_TOKEN:'error'},fetch:async()=>{throw Error('must not fetch');},write:s=>{output+=s;}});
  assert.equal(exit,2); assert.ok(!output.includes('error'));
  const e={...env,ATLASSIAN_API_TOKEN:'\\n'}; output='';
  const result=await main(['page','123','--json'],{env:e,fetch:async()=>Response.json({...page,body:{atlas_doc_format:{value:doc([{type:'text',text:'line\nnext'}])}}}),write:s=>{output+=s;}});
  assert.equal(result,1); assert.equal(JSON.parse(output).code,'security'); assert.ok(!output.includes(e.ATLASSIAN_API_TOKEN));
});

test('validated header/body next links, empty collections and null optional fields', async () => {
  for(const command of ['spaces','children','attachments','labels']) {
    const path=command==='spaces' ? '/wiki/api/v2/spaces' : `/wiki/api/v2/pages/123/${command==='children' ? 'direct-children' : command}`;
    const args=command==='spaces' ? [command,'--json'] : [command,'123','--json'];
    const r=await run(args,{results:[],_links:{next:`${path}?cursor=abc&limit=30`}},200,{link:`<${ORIGIN}${path}?limit=30&cursor=abc>; rel="next"`});
    assert.equal(r.exit,0,r.output); assert.equal(r.value.nextCursor,'abc'); assert.equal(r.value.count,0); assert.equal(r.calls.length,1);
  }
  const r=await run(['spaces','--json'],{results:[{}]}); assert.deepEqual(r.value.spaces,[{id:null,key:null,name:null,type:null,status:null,homepageId:null}]);
  for(const next of ['not a URL','/wiki/api/v2/spaces?cursor=x&cursor=y','/wiki/api/v2/spaces?cursor=']) assert.equal((await run(['spaces','--json'],{results:[],_links:{next}})).exit,1);
  assert.equal((await run(['spaces','--json'],{results:[]},200,{link:'broken; rel="next"'})).value.code,'bad_response');
});

test('launcher help and loader failures are stdout only and secret safe', () => {
  const launcher=new URL('../../bin/confluence-axi',import.meta.url);
  const rejected=spawnSync(process.execPath,['--import',new URL('./reject-build.ts',import.meta.url).href,launcher.pathname,'--json'],{env,encoding:'utf8'});
  assert.equal(rejected.status,1); assert.equal(rejected.stderr,''); assert.equal(JSON.parse(rejected.stdout).code,'transport_error'); assert.ok(!rejected.stdout.includes(env.ATLASSIAN_API_TOKEN));
});

test('ADF links/cards never expose foreign, userinfo or non-HTTPS targets; unsupported leaves visible', async () => {
  const nodes: unknown[]=[];
  for(const url of ['https://evil.test','http://einc.atlassian.net/a','https://x@einc.atlassian.net/a',ORIGIN+'/wiki/a']) { nodes.push({type:'paragraph',content:[{type:'text',text:'Anchor',marks:[{type:'link',attrs:{href:url}}]}]},{type:'inlineCard',attrs:{url}}); }
  nodes.push({type:'extension'},{type:'media',attrs:{alt:'File'}});
  const r=await run(['page','123','--json'],{...page,body:{atlas_doc_format:{value:doc(nodes)}}}); assert.equal(r.exit,0); assert.ok(!r.value.body.includes('evil.test')); assert.match(r.value.body,/omitted/); assert.match(r.value.body,/unsupported/); assert.match(r.value.body,/attachment/); assert.match(r.value.body,/https:\/\/einc.atlassian.net\/wiki\/a/);
  let nested: unknown={type:'text',text:'a'}; for(let i=0;i<66;i++) nested={type:'paragraph',content:[nested]}; assert.equal((await run(['page','123','--json'],{...page,body:{atlas_doc_format:{value:doc([nested])}}})).exit,1);
});
