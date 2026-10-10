// A stand-in for the Gitstalk web app and gateway, for the setup script's tests: the setup
// API, key requests (approved on the second poll, or denied), whoami, and git smart HTTP over
// `git http-backend` behind the same token check the gateway makes. No dependencies.
//
//   node fake-gitstalk.mjs <port> <repos dir> [public origin]
//   GET /__state           what the last key request carried (for assertions)
//   POST /__mode?deny=1    the next request is declined;  ?ssh=<host>  the SSH endpoint is live
import { spawn } from 'node:child_process';
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const [port = '0', reposDir = '.', publicOrigin] = process.argv.slice(2);
const state = {
  requests: [],
  tokens: new Set([process.env.FAKE_DEPLOY_TOKEN ?? 'bsd_fake_deploy']),
  deny: false,
};
let sshHost = process.env.FAKE_SSH_HOST ?? '';

const server = http.createServer((req, res) => {
  void handle(req, res);
});

async function handle(req, res) {
  const origin = publicOrigin ?? `http://${req.headers.host}`;
  const url = new URL(req.url ?? '/', origin);
  const body = await read(req);
  try {
    if (url.pathname === '/api/setup')
      return json(res, 200, {
        web: origin,
        git_origin: origin,
        ssh_host: sshHost === '' ? null : sshHost,
        mcp_url: `${origin}/mcp`,
      });
    if (url.pathname === '/api/ssh-keys/request')
      return keyRequest(res, origin, JSON.parse(body.toString()));
    if (url.pathname === '/api/ssh-keys/poll') return poll(res, JSON.parse(body.toString()));
    if (url.pathname === '/__state') return json(res, 200, { requests: state.requests });
    if (url.pathname === '/__mode') {
      state.deny = url.searchParams.get('deny') === '1';
      sshHost = url.searchParams.get('ssh') ?? '';
      return json(res, 200, { deny: state.deny, ssh_host: sshHost });
    }
    if (url.pathname === '/v1/whoami') {
      const token = tokenOf(req);
      return state.tokens.has(token)
        ? json(res, 200, { kind: 'user', handle: 'smoke', scopes: ['repo:read', 'bean:write'] })
        : unauthorized(res);
    }
    // Git as the web host serves it (`/<owner>/<repo>.git/…`) and at the gateway's `/git/…`.
    if (/^(\/git)?\/[^/]+\/[^/]+\.git\//.test(url.pathname)) {
      if (!state.tokens.has(tokenOf(req))) return unauthorized(res);
      return gitBackend(req, res, url, body);
    }
    json(res, 404, { error: 'no such route' });
  } catch (error) {
    json(res, 500, { error: String(error) });
  }
}
server.listen(Number(port), '0.0.0.0', () => {
  const address = server.address();
  process.stdout.write(`${typeof address === 'object' && address ? address.port : port}\n`);
});

function keyRequest(res, origin, input) {
  if (typeof input.public_key !== 'string' || !/^(ssh-|ecdsa-)/.test(input.public_key))
    return json(res, 400, { error: { code: 'invalid_key', message: 'unsupported key type' } });
  const code = 'BCDF-GHJK';
  const pollToken = randomBytes(32).toString('base64url');
  state.requests.push({ ...input, pollToken, polls: 0, deny: state.deny });
  state.deny = false;
  return json(res, 200, {
    user_code: code,
    poll_token: pollToken,
    fingerprint: 'SHA256:fake',
    verification_uri: `${origin}/settings/keys/add`,
    verification_uri_complete: `${origin}/settings/keys/add?code=${code}`,
    expires_in: 30,
    interval: 1,
  });
}

function poll(res, input) {
  const request = state.requests.find((candidate) => candidate.pollToken === input.poll_token);
  if (request === undefined) return json(res, 200, { status: 'expired' });
  request.polls += 1;
  if (request.polls < 2) return json(res, 200, { status: 'pending' });
  if (request.deny) return json(res, 200, { status: 'denied' });
  if (!request.https_token || request.delivered)
    return json(res, 200, { status: 'approved', handle: 'smoke' });
  request.delivered = true;
  const token = `bsu_${randomBytes(32).toString('base64url')}`;
  state.tokens.add(token);
  return json(res, 200, {
    status: 'approved',
    handle: 'smoke',
    https_token: token,
    https_token_expires_at: Date.now() + 1e9,
  });
}

function tokenOf(req) {
  const [scheme, value = ''] = (req.headers.authorization ?? '').split(/\s+/, 2);
  if (scheme?.toLowerCase() === 'bearer') return value;
  if (scheme?.toLowerCase() !== 'basic') return '';
  const decoded = Buffer.from(value, 'base64').toString();
  return decoded.slice(decoded.indexOf(':') + 1);
}

function unauthorized(res) {
  res.writeHead(401, {
    'content-type': 'text/plain; charset=utf-8',
    'www-authenticate': 'Basic realm="Gitstalk"',
  });
  res.end(
    'Gitstalk: this git is not connected to your account yet. Pick one:\n  1. Claude Code (easiest): /gitstalk:setup\n',
  );
}

function gitBackend(req, res, url, body) {
  const child = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: reposDir,
      GIT_HTTP_EXPORT_ALL: '1',
      REQUEST_METHOD: req.method ?? 'GET',
      PATH_INFO: url.pathname.replace(/^\/git\//, '/'),
      QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: req.headers['content-type'] ?? '',
      CONTENT_LENGTH: String(body.length),
      HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
      GIT_PROTOCOL: req.headers['git-protocol'] ?? '',
      REMOTE_USER: 'smoke',
      REMOTE_ADDR: '127.0.0.1',
    },
  });
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.on('close', () => {
    const output = Buffer.concat(chunks);
    const split = output.indexOf('\r\n\r\n');
    const headerText = output.subarray(0, split).toString();
    const headers = {};
    let status = 200;
    for (const line of headerText.split('\r\n')) {
      const [name, ...rest] = line.split(':');
      const value = rest.join(':').trim();
      if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10);
      else headers[name] = value;
    }
    res.writeHead(status, headers);
    res.end(output.subarray(split + 4));
  });
  child.stdin.end(body);
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

function read(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
