/**
 * Gitstalk's agent loop (doc 25 §7.5): the `agent` harness of an automation, run by Node in
 * the job container. It talks the OpenAI chat-completions dialect with tool calls to the
 * gateway's model proxy (which holds the AI Gateway credentials, enforces the run's and the
 * repository's spend limits and picks nothing itself), and gives the model a small set of
 * tools on the real filesystem: `bash`, `read_file`, `write_file`, `edit_file`, `list_files`
 * and `finish`. Every turn is printed as the run's log.
 *
 * Plain JavaScript with no dependencies, shipped in the compiled job (base64 in `env`), so a
 * change to it is a gateway deploy, not a new job image. Written without template literals.
 */
export const AGENT_LOOP_SOURCE = String.raw`
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const env = process.env;
const url = env.GITSTALK_MODEL_URL + '/chat/completions';
const token = env.GITSTALK_MODEL_TOKEN;
const model = env.GITSTALK_MODEL;
const maxTurns = Number(env.GITSTALK_MAX_TURNS || '40');
const MAX_OUTPUT = 16000;

const tools = [
  tool('bash', 'Run a bash command in the repository checkout (the current directory). Returns exit code, stdout and stderr. Use it for git, tests, searching (grep, find) and anything else.', {
    command: { type: 'string', description: 'The command line' },
    timeout_seconds: { type: 'integer', description: 'Default 120, at most 600' },
  }, ['command']),
  tool('read_file', 'Read a text file (relative to the checkout, or absolute). Lines are numbered.', {
    path: { type: 'string' },
    offset: { type: 'integer', description: 'First line, from 1' },
    limit: { type: 'integer', description: 'Lines to read, default 400' },
  }, ['path']),
  tool('write_file', 'Create or replace a whole file.', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
  tool('edit_file', 'Replace one exact occurrence of old_text with new_text in a file.', {
    path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' },
  }, ['path', 'old_text', 'new_text']),
  tool('list_files', 'List a directory (non-recursive).', { path: { type: 'string' } }, ['path']),
  tool('finish', 'End the run with a short summary of what you did and found.', { summary: { type: 'string' } }, ['summary']),
];

function tool(name, description, properties, required) {
  return { type: 'function', function: { name: name, description: description, parameters: { type: 'object', properties: properties, required: required } } };
}

function clip(text, limit) {
  const value = String(text == null ? '' : text);
  return value.length > limit ? value.slice(0, limit) + '\n[… ' + (value.length - limit) + ' more characters cut]' : value;
}

function oneLine(text, limit) {
  const value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value;
}

function run(name, args) {
  switch (name) {
    case 'bash': {
      const seconds = Math.min(Math.max(Number(args.timeout_seconds) || 120, 1), 600);
      const result = spawnSync('bash', ['-c', String(args.command)], { encoding: 'utf8', timeout: seconds * 1000, maxBuffer: 32 * 1024 * 1024, env: childEnv() });
      const timedOut = result.error && result.error.code === 'ETIMEDOUT';
      return 'exit ' + (timedOut ? 'timeout after ' + seconds + ' s' : result.status) + '\n' + clip(result.stdout, MAX_OUTPUT) + (result.stderr ? '\n[stderr]\n' + clip(result.stderr, MAX_OUTPUT / 2) : '');
    }
    case 'read_file': {
      const lines = readFileSync(resolve(String(args.path)), 'utf8').split('\n');
      const from = Math.max(Number(args.offset) || 1, 1);
      const count = Math.min(Number(args.limit) || 400, 2000);
      return clip(lines.slice(from - 1, from - 1 + count).map(function (line, index) { return (from + index) + '\t' + line; }).join('\n'), MAX_OUTPUT * 2) + (from - 1 + count < lines.length ? '\n[' + lines.length + ' lines in all]' : '');
    }
    case 'write_file': {
      const path = resolve(String(args.path));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, String(args.content));
      return 'wrote ' + path;
    }
    case 'edit_file': {
      const path = resolve(String(args.path));
      const text = readFileSync(path, 'utf8');
      const at = text.indexOf(String(args.old_text));
      if (at < 0) return 'error: old_text not found in ' + path;
      if (text.indexOf(String(args.old_text), at + 1) >= 0) return 'error: old_text occurs more than once in ' + path + '; include more context';
      writeFileSync(path, text.slice(0, at) + String(args.new_text) + text.slice(at + String(args.old_text).length));
      return 'edited ' + path;
    }
    case 'list_files': {
      const path = resolve(String(args.path || '.'));
      return readdirSync(path).map(function (name) { return statSync(resolve(path, name)).isDirectory() ? name + '/' : name; }).join('\n');
    }
    default:
      return 'error: no tool ' + name;
  }
}

/** The tools' processes see neither the model token nor the agent's own settings. */
function childEnv() {
  const copy = Object.assign({}, env);
  for (const key of Object.keys(copy)) if (key.startsWith('GITSTALK_MODEL') || key.endsWith('_B64')) delete copy[key];
  return copy;
}

async function complete(messages) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ model: model, messages: messages, tools: tools, tool_choice: 'auto', max_tokens: 8192 }),
      signal: AbortSignal.timeout(300000),
    });
    const text = await response.text();
    if (response.ok) return { body: JSON.parse(text), spent: response.headers.get('x-beanstalk-run-cost-usd') };
    if (response.status >= 500 && attempt < 3) { console.log('  (model call failed ' + response.status + ', retrying)'); continue; }
    throw new Error('model proxy answered ' + response.status + ': ' + oneLine(text, 400));
  }
}

function output(name, value) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, name + '=' + value + '\n');
}

const messages = [
  { role: 'system', content: readFileSync(env.GITSTALK_SYSTEM_FILE, 'utf8') },
  { role: 'user', content: readFileSync(env.GITSTALK_PROMPT_FILE, 'utf8') },
];
console.log('Agent loop on ' + model + ', at most ' + maxTurns + ' turns, tools: ' + tools.map(function (t) { return t.function.name; }).join(', '));
let turns = 0;
let spent = '';
let summary = null;
let failure = null;
try {
  while (summary === null && turns < maxTurns) {
    turns += 1;
    const answer = await complete(messages);
    if (answer.spent) spent = answer.spent;
    const message = (answer.body.choices && answer.body.choices[0] && answer.body.choices[0].message) || {};
    const calls = message.tool_calls || [];
    if (message.content && String(message.content).trim() !== '') for (const line of String(message.content).trim().split('\n')) console.log(line);
    messages.push({ role: 'assistant', content: message.content || '', tool_calls: calls.length > 0 ? calls : undefined });
    if (calls.length === 0) { summary = message.content || '(no summary)'; break; }
    for (const call of calls) {
      const name = call.function && call.function.name;
      let args = {};
      try { args = JSON.parse((call.function && call.function.arguments) || '{}'); } catch (error) { args = {}; }
      if (name === 'finish') { summary = String(args.summary || ''); messages.push({ role: 'tool', tool_call_id: call.id, content: 'finished' }); continue; }
      console.log('→ ' + name + ' ' + oneLine(args.command || args.path || JSON.stringify(args), 200));
      let result;
      try { result = run(name, args); } catch (error) { result = 'error: ' + (error && error.message ? error.message : String(error)); }
      console.log('  ← ' + oneLine(result, 160));
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
} catch (error) {
  failure = error && error.message ? error.message : String(error);
}
console.log('Agent ' + (failure ? 'stopped' : summary === null ? 'ran out of turns' : 'finished') + ' after ' + turns + ' turns' + (spent ? ', model spend $' + spent : ''));
if (summary) console.log('Summary: ' + clip(summary, 4000));
output('turns', String(turns));
output('cost_usd', spent);
if (failure) { console.log('::error::' + oneLine(failure, 500)); process.exit(1); }
if (summary === null) { console.log('::warning::the agent used all ' + maxTurns + ' turns without finishing'); }
`;
