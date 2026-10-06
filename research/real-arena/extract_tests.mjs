#!/usr/bin/env node
// Extract the test cases a change added or modified in a shared node:test file into a task-owned file.
//
// Usage: node extract_tests.mjs [--residual] <base-file|-> <post-file> <out-file>
//
// The output is the post-change file with every test case (`it(...)` / `test(...)` statement) that exists
// unchanged in the base file removed, and with `describe(...)` blocks left empty by that removal removed too.
// Imports, helpers and hooks (`beforeEach`, ...) are kept, so the extracted cases run exactly as they did in the
// shared file. Prints a JSON summary {kept: [...], dropped: n} on stdout.
//
// --residual writes the complement for the shared file itself: the post-change file without the test cases the
// change ADDED (they live in the task-owned file), keeping modified cases at their new version.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require(process.env.TS_PATH || 'typescript');

const TEST_NAMES = new Set(['it', 'test']);
const SUITE_NAMES = new Set(['describe', 'suite']);

function calleeRoot(expr) {
  // it(...), it.only(...), it.each(...)(...), test.skip(...)
  let e = expr;
  while (e) {
    if (ts.isCallExpression(e)) e = e.expression;
    else if (ts.isPropertyAccessExpression(e)) e = e.expression;
    else break;
  }
  return e && ts.isIdentifier(e) ? e.text : null;
}

function firstArgText(call, sf) {
  const arg = call.arguments[0];
  if (!arg) return '';
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  return arg.getText(sf);
}

function callbackBody(call) {
  for (const a of call.arguments) {
    if ((ts.isArrowFunction(a) || ts.isFunctionExpression(a)) && a.body && ts.isBlock(a.body)) return a.body;
  }
  return null;
}

// Walk statements; returns a list of nodes {kind: 'test'|'suite', key, text, start, end, children}
function collect(statements, sf, path, out) {
  const seen = new Map();
  for (const st of statements) {
    if (!ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression)) continue;
    const call = st.expression;
    const root = calleeRoot(call);
    if (!root) continue;
    const name = firstArgText(call, sf);
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    const key = [...path, `${root}:${name}#${n}`].join(' > ');
    const node = { key, start: st.getFullStart(), end: st.getEnd(), text: st.getText(sf), children: [] };
    if (TEST_NAMES.has(root)) {
      node.kind = 'test';
      out.push(node);
    } else if (SUITE_NAMES.has(root)) {
      node.kind = 'suite';
      const body = callbackBody(call);
      if (body) collect(body.statements, sf, [...path, `${root}:${name}#${n}`], node.children);
      out.push(node);
    }
  }
  return out;
}

function parse(file) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return { text, tree: collect(sf.statements, sf, [], []) };
}

function flatten(nodes, acc = new Map()) {
  for (const n of nodes) {
    if (n.kind === 'test') acc.set(n.key, n.text);
    flatten(n.children, acc);
  }
  return acc;
}

const args = process.argv.slice(2);
const residual = args[0] === '--residual';
if (residual) args.shift();
const [baseFile, postFile, outFile] = args;
if (!postFile || !outFile) {
  console.error('usage: node extract_tests.mjs <base-file|-> <post-file> <out-file>');
  process.exit(2);
}
const base = baseFile && baseFile !== '-' && fs.existsSync(baseFile) ? flatten(parse(baseFile).tree) : new Map();
const post = parse(postFile);

const kept = [];
const cuts = []; // [start, end) ranges of the post text to remove

// returns true when the node keeps at least one test
function visit(node) {
  if (node.kind === 'test') {
    const keep = residual ? base.has(node.key) : base.get(node.key) !== node.text;
    if (keep) kept.push(node.key);
    else cuts.push([node.start, node.end]);
    return keep;
  }
  const before = cuts.length;
  let any = false;
  for (const c of node.children) any = visit(c) || any;
  if (!any) {
    cuts.splice(before); // the children's cuts are covered by the suite's own
    cuts.push([node.start, node.end]); // drop the whole suite (its hooks go with it)
  }
  return any;
}
for (const n of post.tree) visit(n);

cuts.sort((a, b) => a[0] - b[0]);
let out = '';
let pos = 0;
for (const [s, e] of cuts) {
  if (s < pos) continue; // nested inside an already removed range
  out += post.text.slice(pos, s);
  pos = e;
}
out += post.text.slice(pos);
out = out.replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(outFile, out);
console.log(JSON.stringify({ kept, dropped: cuts.length }));
