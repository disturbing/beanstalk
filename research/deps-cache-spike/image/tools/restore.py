#!/usr/bin/env python3
"""Restore a packed node_modules into <dest> and measure it.

usage: restore.py <name> <scheme> <layer> <epoch> <dest> [par]
  scheme  single | shards | pkg | dl-single (download only, to /dev/null)
  layer   r2 | api (Cache API) | wc (Workers Cache); epoch partitions the cache key space
Prints one JSON line: wall ms, bytes fetched, which layer answered, files written, the lowest
MemAvailable and highest Shmem seen (sampled every 50 ms), and the tmpfs usage afterwards.
"""
import json
import os
import subprocess
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, '/spike')
import r2io  # noqa: E402

name, scheme, layer, epoch, dest = sys.argv[1:6]
par = int(sys.argv[6]) if len(sys.argv) > 6 else 0


def meminfo():
    d = {}
    with open('/proc/meminfo') as f:
        for line in f:
            k, v = line.split(':')
            d[k] = int(v.split()[0]) * 1024
    return d


class Sampler(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.stop = False
        m = meminfo()
        self.start_avail, self.start_shmem = m['MemAvailable'], m['Shmem']
        self.min_avail, self.max_shmem = self.start_avail, self.start_shmem

    def run(self):
        while not self.stop:
            m = meminfo()
            self.min_avail = min(self.min_avail, m['MemAvailable'])
            self.max_shmem = max(self.max_shmem, m['Shmem'])
            time.sleep(0.05)


def pipeline(key, target):
    """curl | zstd -d | tar -x; returns (bytes, layer)."""
    hdr = f'/tmp/h-{abs(hash(key))}'
    cmd = f"curl -sfS -D {hdr} '{r2io.url(layer, epoch, key)}' | zstd -dc | tar -x -C {target}"
    subprocess.run(['bash', '-o', 'pipefail', '-c', cmd], check=True)
    headers = open(hdr).read().lower()
    os.remove(hdr)
    got = next((line.split(':', 1)[1].strip() for line in headers.splitlines() if line.startswith('x-layer:')), '?')
    size = next((int(line.split(':', 1)[1]) for line in headers.splitlines() if line.startswith('content-length:')), 0)
    return size, got


os.makedirs(dest, exist_ok=True)
sampler = Sampler()
sampler.start()
t0 = time.perf_counter()
layers = Counter()
fetched = 0
if scheme == 'dl-single':
    r = subprocess.run(['curl', '-sfS', '-o', '/dev/null', '-w', '%{size_download} %{speed_download}', '-D', '/tmp/h-dl', r2io.url(layer, epoch, f'snap/{name}/single.tar.zst')], check=True, capture_output=True, text=True)
    fetched = int(r.stdout.split()[0])
    layers[next((line.split(':', 1)[1].strip() for line in open('/tmp/h-dl').read().lower().splitlines() if line.startswith('x-layer:')), '?')] += 1
elif scheme == 'single':
    size, got = pipeline(f'snap/{name}/single.tar.zst', dest)
    fetched, layers[got] = size, 1
elif scheme == 'shards':
    shards = json.loads(r2io.get('r2', epoch, f'snap/{name}/shards.json')[0])
    with ThreadPoolExecutor(par or len(shards)) as pool:
        for size, got in pool.map(lambda s: pipeline(s['key'], dest), shards):
            fetched += size
            layers[got] += 1
elif scheme == 'pkg':
    manifest = json.loads(r2io.get('r2', epoch, f'snap/{name}/manifest.json')[0])
    size, got = pipeline(f'snap/{name}/layout.tar.zst', dest)
    fetched += size
    layers[got] += 1

    def one(item):
        data, got = r2io.get(layer, epoch, item['key'])
        target = os.path.join(dest, item['path'])
        os.makedirs(target, exist_ok=True)
        subprocess.run(['tar', '-x', '--zstd', '-C', target], input=data, check=True)
        return len(data), got

    with ThreadPoolExecutor(par or 32) as pool:
        for size, got in pool.map(one, manifest):
            fetched += size
            layers[got] += 1
ms = round((time.perf_counter() - t0) * 1000)
sampler.stop = True
sampler.join()
files = int(subprocess.run(f'find {dest} | wc -l', shell=True, capture_output=True, text=True).stdout) if scheme != 'dl-single' else 0
du = subprocess.run(['du', '-sb', dest], capture_output=True, text=True).stdout.split()[0]
print(json.dumps({
    'name': name, 'scheme': scheme, 'layer': layer, 'epoch': epoch, 'dest': dest, 'par': par,
    'ms': ms, 'fetched_bytes': fetched, 'mib_s': round(fetched / 1048576 / (ms / 1000), 1),
    'layers': dict(layers), 'files': files, 'du_bytes': int(du),
    'mem_avail_drop_bytes': sampler.start_avail - sampler.min_avail,
    'shmem_peak_bytes': sampler.max_shmem, 'shmem_growth_bytes': sampler.max_shmem - sampler.start_shmem,
}))
