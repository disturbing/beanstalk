#!/usr/bin/env python3
"""Synthetic node_modules of a given size built from real package files.

usage: gensynth.py <dest root> <GiB> <pool root> [<pool root> ...]
Writes <dest root>/node_modules/syn-NNNN/ packages (about 50 files each, a package.json, a few
nested dirs, some scoped @syn-x/ packages and nested node_modules), every file a real file from
the pool's node_modules with a unique first-line comment, so sizes and compressibility follow
real JavaScript, TypeScript declarations, maps and native binaries. Deterministic (seeded).
"""
import json
import os
import random
import sys

dest, gib, pools = sys.argv[1], float(sys.argv[2]), sys.argv[3:]
target = int(gib * 1024 ** 3)
rng = random.Random(7)
pool = []
for p in pools:
    for dirpath, dirnames, filenames in os.walk(os.path.join(p, 'node_modules')):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if not os.path.islink(fp) and os.path.getsize(fp) < 64 * 1024 * 1024:
                pool.append(fp)
pool.sort()
cache = {}


def content(fp):
    if fp not in cache:
        with open(fp, 'rb') as f:
            cache[fp] = f.read()
    return cache[fp]


nm = os.path.join(dest, 'node_modules')
os.makedirs(nm, exist_ok=True)
written = files = pkgs = 0
while written < target:
    scoped = pkgs % 10 == 0
    nested = pkgs % 7 == 0 and pkgs > 0
    name = f'@syn-{pkgs % 50}/p{pkgs:05d}' if scoped else f'syn-{pkgs:05d}'
    base = os.path.join(nm, f'syn-{pkgs - 1:05d}', 'node_modules', name) if nested and not scoped else os.path.join(nm, name)
    os.makedirs(base, exist_ok=True)
    with open(os.path.join(base, 'package.json'), 'w') as f:
        json.dump({'name': name, 'version': f'1.{pkgs % 13}.0', 'main': 'index.js'}, f)
    for i in range(rng.randint(10, 90)):
        src = rng.choice(pool)
        sub = ['', 'lib', 'dist', 'dist/esm', 'types'][i % 5]
        ext = os.path.splitext(src)[1] or '.js'
        fp = os.path.join(base, sub, f'f{i:03d}{ext}')
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        data = content(src)
        with open(fp, 'wb') as f:
            f.write(f'/* {name} {i} */\n'.encode())
            f.write(data)
        written += len(data) + 32
        files += 1
    pkgs += 1
print(json.dumps({'dest': dest, 'packages': pkgs, 'files': files, 'bytes': written, 'pool_files': len(pool)}))
