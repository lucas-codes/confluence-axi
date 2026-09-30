export class Failure extends Error {
  code: string;
  constructor(code: string, message: string = code) { super(message); this.code = code; }
}
export type Env = Record<string, string | undefined>;
export function secrets(env: Env): string[] {
  const tokens = [env.ATLASSIAN_API_TOKEN, env.JIRA_API_TOKEN].filter((s): s is string => !!s);
  const token = env.ATLASSIAN_API_TOKEN || env.JIRA_API_TOKEN;
  if (env.ATLASSIAN_EMAIL && token) tokens.push(Buffer.from(env.ATLASSIAN_EMAIL + ':' + token).toString('base64'));
  return tokens.sort((a,b) => b.length-a.length);
}
export function redact(value: string, hidden: string[]): string {
  for (const secret of hidden) value = value.split(secret).join('[redacted]');
  return value;
}
export function sanitize(value: string, body = false): string {
  return value
    .replace(/(?:\x1b\[|\u009b)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/(?:\x1b\]|\u009d)[\s\S]*?(?:\x07|\x1b\\|\u009c)/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
    .replace(/[\n\t]/g, body ? '$&' : ' ');
}
export function clean(value: string, hidden: string[], body = false): string {
  return redact(sanitize(redact(value, hidden), body), hidden);
}
export function cursorSafe(value: string, hidden: string[], code: string): string {
  if (!value || Buffer.byteLength(value) > 8192 || clean(value, hidden) !== value) throw new Failure(code, 'Unsafe or oversized cursor');
  return value;
}
export function credentials(env: Env): string {
  const email = env.ATLASSIAN_EMAIL;
  const token = env.ATLASSIAN_API_TOKEN || env.JIRA_API_TOKEN;
  if (!email || !token) throw new Failure('token_missing', 'Require ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN or JIRA_API_TOKEN');
  if (/[\x00-\x1f\x7f-\x9f:]/.test(email) || [env.ATLASSIAN_API_TOKEN,env.JIRA_API_TOKEN].some(t => t && /[\x00-\x1f\x7f-\x9f]/.test(t))) throw new Failure('security', 'Invalid credential characters');
  return Buffer.from(email + ':' + token).toString('base64');
}
