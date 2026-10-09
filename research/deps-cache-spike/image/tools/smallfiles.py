#!/usr/bin/env python3
"""Small-file create/stat/read/delete on one directory, the way node_modules is used.

usage: smallfiles.py <dir> [files=100000] [bytes=4096]
Creates <files> files of <bytes> each in 1,000 directories, then (after a sync and a page-cache
drop) stats every file, reads every file cold, reads again warm, and deletes the tree.
Prints one JSON line with milliseconds per phase.
"""
import json
import os
import shutil
import subprocess
import sys
import time

root = os.path.join(sys.argv[1], 'smallfiles')
n = int(sys.argv[2]) if len(sys.argv) > 2 else 100_000
size = int(sys.argv[3]) if len(sys.argv) > 3 else 4096
per_dir = 100
payload = (b'module.exports = function () { return 42 }\n' * (size // 44 + 1))[:size]


def ms(t0):
    return round((time.perf_counter() - t0) * 1000)


def drop():
    subprocess.run(['sync'])
    try:
        with open('/proc/sys/vm/drop_caches', 'w') as f:
            f.write('3\n')
        return True
    except OSError:
        return False


shutil.rmtree(root, ignore_errors=True)
paths = [os.path.join(root, f'd{i // per_dir:04d}', f'f{i % per_dir:03d}.js') for i in range(n)]
out = {'dir': sys.argv[1], 'files': n, 'bytes': size}
t0 = time.perf_counter()
for d in sorted({os.path.dirname(p) for p in paths}):
    os.makedirs(d)
for p in paths:
    with open(p, 'wb') as f:
        f.write(payload)
out['create_ms'] = ms(t0)
t0 = time.perf_counter()
subprocess.run(['sync'])
out['sync_ms'] = ms(t0)
out['dropped'] = drop()
t0 = time.perf_counter()
for p in paths:
    os.stat(p)
out['stat_cold_ms'] = ms(t0)
drop()
t0 = time.perf_counter()
for p in paths:
    with open(p, 'rb') as f:
        f.read()
out['read_cold_ms'] = ms(t0)
t0 = time.perf_counter()
for p in paths:
    with open(p, 'rb') as f:
        f.read()
out['read_warm_ms'] = ms(t0)
t0 = time.perf_counter()
shutil.rmtree(root)
subprocess.run(['sync'])
out['delete_ms'] = ms(t0)
print(json.dumps(out))
