import { createRequire } from 'node:module';
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const fromMcp = createRequire('/Users/coop/Workspace/beanstalk/packages/mcp/package.json');
const { Client, StreamableHTTPClientTransport } = fromMcp('@modelcontextprotocol/client');
const [role, tool, argument = '{}'] = process.argv.slice(2);
if (!['shipping', 'checkout', 'returns', 'view'].includes(role) || !tool)
  throw new Error('Usage: node client.mjs shipping|checkout|returns|view list|tool_name JSON|@FILE');
const runtime = '/private/tmp/beanstalk-three-agent-trial';
const credential = JSON.parse(readFileSync(path.join(runtime, 'private', `${role}.json`), 'utf8'));
const client = new Client({ name: `live-trial-${role}`, version: '0.1.0' });
const transport = new StreamableHTTPClientTransport(new URL(`${credential.origin}/mcp`), {
  requestInit: { headers: { authorization: `Bearer ${credential.token}` } },
});

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key, /token|secret|authorization/i.test(key) ? '[redacted]' : redact(entry),
  ]));
  if (typeof value === 'string') return value.replace(/bst1\.[A-Za-z0-9_.-]+/g, '[redacted]');
  return value;
}

function record(entry) {
  const evidence = redact({ at: new Date().toISOString(), role, bean: credential.bean,
    run: credential.run, ...entry });
  appendFileSync(path.join(runtime, 'evidence', `${role}.jsonl`), `${JSON.stringify(evidence)}\n`);
}

function contentValue(result) {
  const text = result.content?.find((entry) => entry.type === 'text')?.text;
  if (text === undefined) return result;
  try { return JSON.parse(text); }
  catch { return text; }
}

try {
  await client.connect(transport);
  const input = tool === 'list' ? null : JSON.parse(argument.startsWith('@') ? readFileSync(argument.slice(1), 'utf8') : argument);
  const result = tool === 'list' ? await client.listTools() : await client.callTool({ name: tool, arguments: input });
  const output = contentValue(result);
  record({ tool, input, is_error: result.isError === true, output });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (result.isError === true) process.exitCode = 1;
} catch (error) {
  const output = { error: { name: error.name, message: redact(error.message), code: error.code } };
  record({ tool, is_error: true, transport_error: true, output });
  process.stderr.write(`${JSON.stringify(output)}\n`);
  process.exitCode = 1;
} finally {
  await client.close();
}
