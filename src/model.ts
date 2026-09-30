import type { Args } from './args.ts';
import { collection } from './args.ts';
import { navigation, nextCursor, request } from './api.ts';
import type { Fetch } from './api.ts';
import { Failure } from './security.ts';
import { adfToText } from './adf.ts';
export type ObjectValue = Record<string,unknown>;
export function object(value: unknown): ObjectValue {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new Failure('bad_response','Expected response object');
  return value as ObjectValue;
}
function optionalObject(value: unknown): ObjectValue { return value==null ? {} : object(value); }
function string(o: ObjectValue, key: string): string | null {
  const v=o[key]; if(v==null) return null;
  if(typeof v!=='string') throw new Failure('bad_response','Invalid string field');
  return v;
}
function number(o: ObjectValue, key: string): number | null {
  const v=o[key]; if(v==null) return null;
  if(typeof v!=='number' || !Number.isSafeInteger(v) || v<0) throw new Failure('bad_response','Invalid integer field');
  return v;
}
function v1Id(o: ObjectValue): string | null {
  const v=o.id; if(v==null) return null;
  if(typeof v==='string') return v;
  if(typeof v==='number' && Number.isSafeInteger(v) && v>0) return String(v);
  throw new Failure('bad_response','Unsafe identifier');
}
function fields(o: ObjectValue, names: string[]): ObjectValue { return Object.fromEntries(names.map(n=>[n,string(o,n)])); }
export async function load(args: Args, basic: string, fetcher: Fetch, hidden: string[], origin: string): Promise<ObjectValue> {
  const {command,id}=args;
  const path = command==='status' ? '/wiki/rest/api/user/current' : command==='search' ? '/wiki/rest/api/search' : command==='spaces' ? '/wiki/api/v2/spaces' : `/wiki/api/v2/pages/${id}${command==='page' ? '' : '/'+(command==='children' ? 'direct-children' : command)}`;
  const url=new URL(path,origin);
  if(collection(command)) { url.searchParams.set('limit',String(args.limit)); if(args.cursor) url.searchParams.set('cursor',args.cursor); }
  if(command==='search') url.searchParams.set('cql',args.cql!);
  if(command==='page') url.searchParams.set('body-format','atlas_doc_format');
  const {data:raw,link}=await request(url.href,basic,fetcher,origin);
  const data=object(raw);
  if(command==='status') {
    const type=string(data,'type'), accountId=string(data,'accountId');
    const displayName=string(data,'displayName'), publicName=string(data,'publicName');
    if(!['known','user'].includes(type ?? '') || !accountId?.trim()) throw new Failure('bad_response','Response did not identify an authenticated user');
    return {origin,version:'0.1.0',auth:'ok',accountId,displayName:displayName ?? publicName};
  }
  if(command==='page') {
    if(string(data,'id')!==id) throw new Failure('bad_response','Page ID mismatch');
    const version=optionalObject(data.version), links=optionalObject(data._links);
    const body=object(data.body), adf=object(body.atlas_doc_format), value=string(adf,'value');
    if(value===null) throw new Failure('bad_response','Missing ADF body');
    return {...fields(data,['id','title','status','spaceId','parentId']),version:number(version,'number'),created:string(data,'createdAt'),updated:string(version,'createdAt'),url:navigation(string(links,'webui'),origin),body:adfToText(value,origin)};
  }
  if(!Array.isArray(data.results) || data.results.length>args.limit) throw new Failure('bad_response','Invalid collection results');
  const rows=data.results.map(object).map(r=>{
    switch(command) {
      case 'search': {
        const content=optionalObject(r.content),space=optionalObject(r.space);
        return {id:content.id==null ? v1Id(space) : string(content,'id'),type:string(r,'entityType'),title:string(r,'title'),url:navigation(string(r,'url'),origin),excerpt:string(r,'excerpt'),updated:string(r,'lastModified')};
      }
      case 'spaces': return fields(r,['id','key','name','type','status','homepageId']);
      case 'children': return {...fields(r,['id','title','status','spaceId']),position:number(r,'childPosition'),type:string(r,'type')};
      case 'attachments': return {...fields(r,['id','title','mediaType']),fileSize:number(r,'fileSize'),created:string(r,'createdAt'),version:number(optionalObject(r.version),'number')};
      case 'labels': return fields(r,['id','name','prefix']);
      default: throw new Failure('usage');
    }
  });
  const emitted=command==='children' ? rows.filter(r=>r.type==='page').map(({type,...r})=>r) : rows;
  const cursor=nextCursor(data,link,path,hidden,origin);
  return {...(command==='search' ? {query:args.cql,total:number(data,'totalSize')} : {}),...(['children','attachments','labels'].includes(command) ? {pageId:id} : {}),count:emitted.length,hasMore:cursor!==null,nextCursor:cursor,[command==='search'?'results':command]:emitted};
}
