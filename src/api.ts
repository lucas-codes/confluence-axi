import { Failure, cursorSafe } from './security.ts';
export const ORIGIN = 'https://einc.atlassian.net';
const PATH = /^\/wiki\/(?:rest\/api\/(?:search|user\/current)|api\/v2\/(?:spaces|pages\/[1-9]\d*(?:\/(?:direct-children|attachments|labels))?))$/;
export function validateUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input, ORIGIN); } catch { throw new Failure('security','Invalid request URL'); }
  if (url.origin !== ORIGIN || url.protocol!=='https:' || url.port && url.port!=='443' || url.username || url.password || url.hash || !PATH.test(url.pathname)) throw new Failure('security','Disallowed request URL');
  return url;
}
export function navigation(input: string | null): string | null {
  if (!input) return null;
  try {
    const url = new URL(input.startsWith('/rest/') || input.startsWith('/spaces/') ? '/wiki'+input : input, ORIGIN);
    if(url.origin!==ORIGIN || url.username || url.password || url.protocol!=='https:') return null;
    return url.href;
  } catch { return null; }
}
export type Fetch = typeof globalThis.fetch;
export async function request(input: string, basic: string, fetcher: Fetch): Promise<{data: unknown; link: string | null}> {
  const url = validateUrl(input);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve,reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Failure('transport_error','Request deadline exceeded')); },30000); });
  const work = async () => {
    const response = await fetcher(url.href,{ method:'GET',redirect:'manual',headers:{ Authorization:'Basic '+basic,Accept:'application/json' },signal:controller.signal });
    if(response.status>=300 && response.status<400) throw new Failure('security','Redirect refused');
    if(!response.ok) throw new Failure(({401:'unauthorized',403:'forbidden',404:'not_found',429:'rate_limited'} as Record<number,string>)[response.status] ?? 'http_error','HTTP request failed ('+response.status+')');
    if(!/^application\/(?:[\w.+-]*\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Failure('bad_json','Expected JSON response');
    const reader = response.body?.getReader(); if (!reader) throw new Failure('bad_json','Empty response');
    const chunks: Uint8Array[] = []; let size=0;
    try {
      while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>5*1024*1024) throw new Failure('response_too_large'); chunks.push(value); }
    } finally { if(size>5*1024*1024) { controller.abort(); await reader.cancel(); } reader.releaseLock(); }
    let data: unknown;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Failure('bad_json','Invalid JSON response'); }
    return {data,link:response.headers.get('link')};
  };
  try { return await Promise.race([work(),deadline]); }
  catch(error) { if(error instanceof Failure) throw error; throw new Failure('transport_error','Request failed'); }
  finally { clearTimeout(timeout); controller.abort(); }
}
export function nextCursor(data: Record<string,unknown>, link: string | null, path: string, hidden: string[]): string | null {
  const candidates: string[] = [];
  if(data._links!=null) {
    if(typeof data._links!=='object' || Array.isArray(data._links)) throw new Failure('bad_response');
    const next = (data._links as Record<string,unknown>).next;
    if(next!=null) { if(typeof next!=='string' || !next) throw new Failure('bad_response'); candidates.push(next); }
  }
  if(link) {
    const parts = link.split(/,(?=\s*<)/);
    for(const part of parts) {
      const match = /^\s*<([^<>]+)>\s*((?:;\s*[\w-]+=(?:"[^"]*"|[^;\s]+))*)\s*$/.exec(part);
      if(!match) throw new Failure('bad_response','Malformed Link header');
      if(/;\s*rel=(?:"next"|next)(?:;|\s*$)/.test(match[2]!)) candidates.push(match[1]!);
    }
  }
  let result: string | null = null;
  let canonical: string | null = null;
  for(const raw of candidates) {
    const url = validateUrl(raw.startsWith('/rest/api/') ? '/wiki'+raw : raw);
    if(url.pathname!==path) throw new Failure('security','Pagination endpoint changed');
    const cursors = url.searchParams.getAll('cursor');
    if(cursors.length!==1) throw new Failure('bad_response','Next link requires one cursor');
    const cursor = cursorSafe(cursors[0]!,hidden,'bad_response');
    url.searchParams.sort();
    if(canonical!==null && canonical!==url.href) throw new Failure('bad_response','Conflicting next links');
    canonical = url.href; result = cursor;
  }
  return result;
}
