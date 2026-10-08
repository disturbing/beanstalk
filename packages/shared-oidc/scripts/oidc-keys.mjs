#!/usr/bin/env node
// Key-set tool for OIDC_SIGNING_KEYS. Writes the secret JSON to stdout only; pipe it straight
// into `wrangler secret put OIDC_SIGNING_KEYS` and never into a terminal, a log or a file in git.
//
//   node oidc-keys.mjs new [RS256|ES256]            a fresh set with one active key
//   node oidc-keys.mjs add [RS256|ES256] < old.json the set plus a new, published-but-not-signing key
//   node oidc-keys.mjs activate <kid> < old.json    the set with <kid> as the signing key
//   node oidc-keys.mjs retire <kid> < old.json      the set without <kid> (it must not be active)
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [command, argument] = process.argv.slice(2);

async function newKey(alg = 'RS256') {
  const parameters =
    alg === 'RS256'
      ? {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        }
      : { name: 'ECDSA', namedCurve: 'P-256' };
  if (alg !== 'RS256' && alg !== 'ES256') throw new Error('alg must be RS256 or ES256');
  const pair = await webcrypto.subtle.generateKey(parameters, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const random = Buffer.from(webcrypto.getRandomValues(new Uint8Array(6))).toString('base64url');
  const kid = `${new Date().toISOString().slice(0, 10)}-${random}`;
  return { ...jwk, kid, alg, key_ops: undefined, ext: undefined };
}

function existing() {
  return JSON.parse(readFileSync(0, 'utf8'));
}

let result;
if (command === 'new') {
  const key = await newKey(argument);
  result = { active: key.kid, keys: [key] };
} else if (command === 'add') {
  const set = existing();
  result = { ...set, keys: [...set.keys, await newKey(argument)] };
} else if (command === 'activate') {
  const set = existing();
  if (!set.keys.some((key) => key.kid === argument)) throw new Error('unknown kid');
  result = { ...set, active: argument };
} else if (command === 'retire') {
  const set = existing();
  if (set.active === argument) throw new Error('cannot retire the active key');
  result = { ...set, keys: set.keys.filter((key) => key.kid !== argument) };
} else {
  throw new Error('usage: oidc-keys.mjs new|add|activate|retire ...');
}
process.stdout.write(JSON.stringify(result));
