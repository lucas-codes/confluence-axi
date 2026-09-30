import { Failure } from './security.ts';
import { navigation } from './api.ts';

export function adfToText(value: string, origin: string): string {
  let root: unknown;
  try { root = JSON.parse(value); } catch { throw new Failure('bad_response','Invalid ADF JSON'); }
  let count = 0;
  function object(v: unknown): Record<string,unknown> {
    if(!v || typeof v!=='object' || Array.isArray(v)) throw new Failure('bad_response','Invalid ADF node');
    return v as Record<string,unknown>;
  }
  const doc = object(root);
  if(doc.type!=='doc' || doc.version!==1 || !Array.isArray(doc.content)) throw new Failure('bad_response','Invalid ADF document');
  function render(v: unknown, depth: number): string {
    if(depth>64 || ++count>100000) throw new Failure('bad_response','ADF traversal limit exceeded');
    const n = object(v);
    if(typeof n.type!=='string' || !n.type || n.text!==undefined && typeof n.text!=='string' || n.content!==undefined && !Array.isArray(n.content)) throw new Failure('bad_response','Invalid ADF node fields');
    const attrs = n.attrs===undefined ? {} : object(n.attrs);
    for(const name of ['href','url','text','shortName','language','alt','title','panelType','state','timestamp']) if(attrs[name]!==undefined && typeof attrs[name]!=='string') throw new Failure('bad_response','Invalid ADF attributes');
    for(const name of ['level','order']) if(attrs[name]!==undefined && (typeof attrs[name]!=='number' || !Number.isSafeInteger(attrs[name]))) throw new Failure('bad_response','Invalid ADF attributes');
    const children = (n.content as unknown[] | undefined ?? []).map(c=>render(c,depth+1));
    let text = typeof n.text==='string' ? n.text : children.join('');
    if(n.marks!==undefined) {
      if(!Array.isArray(n.marks)) throw new Failure('bad_response','Invalid ADF marks');
      for(const mark of n.marks) {
        const m=object(mark); if(typeof m.type!=='string') throw new Failure('bad_response','Invalid ADF mark');
        const a=m.attrs===undefined ? {} : object(m.attrs);
        if(m.type==='link') {
          if(typeof a.href!=='string') throw new Failure('bad_response','Invalid link');
          const url=navigation(a.href, origin); text+=url ? ' ('+url+')' : ' [link omitted]';
        } else if(m.type==='code') text='`'+text+'`';
      }
    }
    switch(n.type) {
      case 'doc': return children.join('');
      case 'text': return text;
      case 'hardBreak': return '\n';
      case 'paragraph': return text+'\n\n';
      case 'heading': return '#'.repeat(Math.min(6,Math.max(1,Number(attrs.level ?? 1))))+' '+text+'\n\n';
      case 'bulletList': return children.map(c=>'- '+c.trim().replace(/\n/g,'\n  ')).join('\n')+'\n\n';
      case 'orderedList': return children.map((c,i)=>`${Number(attrs.order ?? 1)+i}. ${c.trim().replace(/\n/g,'\n  ')}`).join('\n')+'\n\n';
      case 'listItem': case 'taskItem': return text;
      case 'taskList': return children.map(c=>'[ ] '+c.trim()).join('\n')+'\n\n';
      case 'codeBlock': return '```'+(attrs.language ?? '')+'\n'+text+'\n```\n\n';
      case 'blockquote': return text.trim().split('\n').map(l=>'> '+l).join('\n')+'\n\n';
      case 'table': return children.join('')+'\n';
      case 'tableRow': return children.map(c=>c.trim()).join(' | ')+'\n';
      case 'tableCell': case 'tableHeader': return text.trim()+' ';
      case 'rule': return '\n---\n';
      case 'mention': return String(attrs.text ?? '@user');
      case 'emoji': return String(attrs.text ?? attrs.shortName ?? '[emoji]');
      case 'status': return '['+String(attrs.text ?? 'status')+']';
      case 'inlineCard': case 'blockCard': case 'embedCard': {
        const url=navigation(typeof attrs.url==='string' ? attrs.url : null, origin);
        return url ?? '[card omitted]';
      }
      case 'media': case 'mediaSingle': case 'mediaGroup': return '[attachment'+(attrs.alt ? ': '+attrs.alt : '')+']';
      case 'panel': return '['+String(attrs.panelType ?? 'panel')+']\n'+text;
      case 'expand': case 'nestedExpand': return String(attrs.title ?? '')+'\n'+text;
      default: return text || '[unsupported: '+n.type+']';
    }
  }
  return render(doc,0).replace(/[ \t]+$/gm,'').replace(/\n{3,}/g,'\n\n').trim();
}
