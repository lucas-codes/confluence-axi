import type { Args } from './args.ts';
import { clean, redact, Failure } from './security.ts';

export const OUTPUT_MAX = 512*1024;
function scalar(value: unknown): string {
  if(value==null || value==='') return '-';
  if(typeof value!=='string') return String(value);
  if(value!==value.trim() || /[,:[\]{}"\\\n\t]/.test(value) || /^(?:-|true$|false$|null$|\d)/.test(value)) return JSON.stringify(value);
  return value;
}
function toon(o: Record<string,unknown>, indent=''): string {
  const lines: string[]=[];
  for(const [key,v] of Object.entries(o)) {
    if(Array.isArray(v)) {
      const rows=v as Record<string,unknown>[]; const keys=Object.keys(rows[0] ?? {});
      const tabular=rows.every(r=>r && typeof r==='object' && Object.keys(r).join()===keys.join() && Object.values(r).every(c=>c===null || typeof c!=='object'));
      if(tabular) { lines.push(`${indent}${key}[${rows.length}]{${keys.join(',')}}:`); for(const r of rows) lines.push(indent+'  '+keys.map(k=>scalar(r[k])).join(',')); }
      else { lines.push(`${indent}${key}[${rows.length}]:`); for(const r of rows) { const nested=toon(r,indent+'    ').split('\n'); lines.push(indent+'  - '+nested[0]!.trimStart(),...nested.slice(1)); } }
    } else if(v!==null && typeof v==='object') { lines.push(indent+key+':',toon(v as Record<string,unknown>,indent+'  ')); }
    else if(key==='body' && typeof v==='string') { lines.push(indent+'body:'); for(const line of v.split('\n')) lines.push(indent+'  '+line); }
    else lines.push(indent+key+': '+scalar(v));
  }
  return lines.join('\n');
}
export function normalize(value: Record<string,unknown>, args: Pick<Args,'full'|'maxChars'>, hidden: string[]): Record<string,unknown> {
  function visit(o: Record<string,unknown>): Record<string,unknown> {
    const result: Record<string,unknown>={}, truncated: Record<string,number>={};
    for(const [k,v] of Object.entries(o)) {
      if(typeof v==='string') {
        if(k==='nextCursor') { result[k]=v; continue; }
        const safe=clean(v,hidden,k==='body'); const points=Array.from(safe);
        const max=k==='body' ? args.maxChars : k==='excerpt' ? (args.full?1000:600) : (args.full?1000:90);
        result[k]=redact(points.slice(0,max).join(''),hidden);
        if(k==='body') { result.bodyLength=points.length; result.bodyTruncated=points.length>max; }
        else if(points.length>max) truncated[k]=points.length;
      } else if(Array.isArray(v)) result[k]=v.map(r=>visit(r as Record<string,unknown>));
      else if(v!==null && typeof v==='object') result[k]=visit(v as Record<string,unknown>);
      else result[k]=v;
    }
    if(Object.keys(truncated).length) result.truncatedFields=truncated;
    return result;
  }
  return visit(value);
}
export function serialize(value: Record<string,unknown>, json: boolean, hidden: string[]): string {
  const output=(json ? JSON.stringify(value,null,2) : toon(value))+'\n';
  if(Buffer.byteLength(output)>OUTPUT_MAX) throw new Failure('output_too_large','Serialized output exceeds 512 KiB');
  if(hidden.some(secret=>output.includes(secret))) throw new Failure('security','Credential echo refused');
  return output;
}
export function textOutput(value: string, hidden: string[]): string {
  const output=clean(value,hidden,true)+'\n';
  if(Buffer.byteLength(output)>OUTPUT_MAX || hidden.some(s=>output.includes(s))) throw new Failure('security','Unsafe diagnostic output');
  return output;
}
