import { Failure, cursorSafe } from './security.ts';
export type Command = 'status' | 'search' | 'spaces' | 'page' | 'children' | 'attachments' | 'labels' | 'help';
export interface Args { command: Command; id?: string; cql?: string; cursor?: string; limit: number; maxChars: number; full: boolean; json: boolean; help: boolean; version: boolean; }
const commands = new Set(['status','search','spaces','page','children','attachments','labels','help']);
const aliases: Record<string,string> = {'-q':'--cql','-h':'--help','-v':'--version','-V':'--version'};
const booleans = new Set(['--json','--help','--version','--full']);
const values = new Set(['--cql','--limit','--cursor','--max-chars']);
export const collection = (c: string): boolean => ['search','spaces','children','attachments','labels'].includes(c);
export function parse(argv: string[], hidden: string[]): Args {
  const flags = new Map<string,string | true>(); const positions: string[] = [];
  for (let i=0;i<argv.length;i++) {
    const word = argv[i]!;
    if (!word.startsWith('-')) { positions.push(word); continue; }
    const flag = aliases[word] ?? word;
    if (!booleans.has(flag) && !values.has(flag)) throw new Failure('usage','Unknown flag');
    if (flags.has(flag)) throw new Failure('usage','Duplicate flag');
    if (booleans.has(flag)) flags.set(flag,true);
    else {
      const value = argv[++i];
      if (value === undefined || value.startsWith('-')) throw new Failure('usage','Missing flag value');
      flags.set(flag,value);
    }
  }
  const command = positions.shift() ?? 'status';
  if (!commands.has(command)) throw new Failure('usage','Unknown command');
  const takesId = ['page','children','attachments','labels'].includes(command);
  const id = takesId ? positions.shift() : undefined;
  if (positions.length) throw new Failure('usage','Unexpected positional argument');
  if (id !== undefined && (!/^[1-9]\d*$/.test(id) || id.length>19 || BigInt(id)>9223372036854775807n)) throw new Failure('usage','ID must be a positive decimal int64 without leading zeroes');
  for (const flag of flags.keys()) {
    if (flag==='--cql' && command!=='search' || ['--limit','--cursor'].includes(flag) && !collection(command) || flag==='--max-chars' && command!=='page' || flag==='--full' && ['status','help'].includes(command)) throw new Failure('usage','Flag is not supported by this command');
  }
  if (flags.has('--help') && flags.has('--version') || flags.has('--full') && flags.has('--max-chars')) throw new Failure('usage','Conflicting flags');
  const help = flags.has('--help') || command==='help', version = flags.has('--version');
  const cql = flags.get('--cql') as string | undefined;
  if (cql !== undefined && !cql.trim()) throw new Failure('usage','CQL must not be empty');
  if (!help && !version && (takesId && !id || command==='search' && !cql)) throw new Failure('usage','Missing ID or --cql');
  function number(flag: string, fallback: number, max: number): number {
    const value = flags.get(flag); if (value===undefined) return fallback;
    if (typeof value!=='string' || !/^[1-9]\d*$/.test(value) || Number(value)>max) throw new Failure('usage','Numeric flag is out of range');
    return Number(value);
  }
  const cursor = flags.get('--cursor') as string | undefined;
  if (cursor!==undefined) cursorSafe(cursor,hidden,'usage');
  const full = flags.has('--full');
  return { command:command as Command,id,cql,cursor,limit:number('--limit',30,100),maxChars:number('--max-chars',full?20000:2000,20000),full,json:flags.has('--json'),help,version };
}
