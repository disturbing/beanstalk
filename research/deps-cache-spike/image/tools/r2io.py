"""Talk to the spike Worker's store through the container's outbound handler (deps.internal)."""
import http.client
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = 'http://deps.internal'
PART = 64 * 1024 * 1024
SINGLE_MAX = 90 * 1024 * 1024


RETRIES = {'n': 0}


def _req(method, path, data=None, headers=None):
    for attempt in range(6):
        req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=600) as res:
                return res.read(), dict(res.headers)
        except urllib.error.HTTPError as err:
            if err.code < 500 or attempt == 5:
                raise
        except (ConnectionError, TimeoutError, urllib.error.URLError, http.client.HTTPException):
            if attempt == 5:
                raise
        RETRIES['n'] += 1
        time.sleep(0.2 * 2 ** attempt)


def put_bytes(key, data):
    body, _ = _req('PUT', f'/r2/{key}', data, {'content-length': str(len(data))})
    return json.loads(body)


def put_file(key, path, par=4):
    """Single PUT up to 90 MiB, multipart (64 MiB parts, `par` at a time) above."""
    size = os.path.getsize(path)
    if size <= SINGLE_MAX:
        with open(path, 'rb') as f:
            return put_bytes(key, f.read())
    up = json.loads(_req('POST', f'/mpu/create/{key}')[0])['uploadId']
    n_parts = (size + PART - 1) // PART

    def part(i):
        with open(path, 'rb') as f:
            f.seek(i * PART)
            chunk = f.read(PART)
        body, _ = _req('PUT', f'/mpu/part/{key}?u={urllib.parse.quote(up)}&n={i + 1}', chunk, {'content-length': str(len(chunk))})
        return json.loads(body)

    with ThreadPoolExecutor(par) as pool:
        parts = list(pool.map(part, range(n_parts)))
    body, _ = _req('POST', f'/mpu/complete/{key}?u={urllib.parse.quote(up)}', json.dumps(parts).encode(), {'content-type': 'application/json'})
    return json.loads(body)


def exists(key):
    try:
        _req('HEAD', f'/r2/{key}')
        return True
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return False
        raise


def url(layer, epoch, key):
    return f'{BASE}/r2/{key}' if layer == 'r2' else f'{BASE}/{layer}/{epoch}/{key}'


def get(layer, epoch, key):
    path = url(layer, epoch, key)[len(BASE):]
    body, headers = _req('GET', path)
    return body, headers.get('x-layer', headers.get('X-Layer', '?'))
