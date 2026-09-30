import { pathToFileURL } from 'node:url';
import { parse } from './args.ts';
import { credentials, secrets, Failure } from './security.ts';
import type { Env } from './security.ts';
import type { Fetch } from './api.ts';
import { load } from './model.ts';
import { normalize, serialize, textOutput } from './render.ts';
import { helpText, responseHints, VERSION } from './help.ts';
export interface Runtime { env: Env; fetch: Fetch; write: (output: string) => void; }
export async function main(argv: string[], runtime: Runtime = {env:process.env,fetch:globalThis.fetch,write:s=>{process.stdout.write(s);}}): Promise<number> {
  const hidden=secrets(runtime.env);
  let json=argv.includes('--json');
  let exit=0, output: string;
  try {
    const args=parse(argv,hidden); json=args.json;
    if(args.help || args.version) output=textOutput(args.help ? helpText() : VERSION,hidden);
    else output=serialize(responseHints(normalize(await load(args,credentials(runtime.env),runtime.fetch,hidden),args,hidden),args),json,hidden);
  } catch(error) {
    const failure=error instanceof Failure ? error : new Failure('transport_error','Operation failed');
    exit=failure.code==='usage' ? 2 : 1;
    try { output=serialize({...normalize({error:failure.message,code:failure.code},{full:false,maxChars:2000},hidden),help:['confluence-axi --help']},json,hidden); }
    catch {
      const fallback=json ? '{"error":"Output refused","code":"security"}\n' : 'error: Output refused\ncode: security\n';
      output=hidden.some(s=>fallback.includes(s)) ? '\n' : fallback;
    }
  }
  // A single write avoids partial output on shape, security or size failures.
  runtime.write(output);
  return exit;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) process.exitCode=await main(process.argv.slice(2));
