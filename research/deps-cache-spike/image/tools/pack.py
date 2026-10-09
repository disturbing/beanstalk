#!/usr/bin/env python3
"""Pack one node_modules tree three ways and upload each to R2 (through deps.internal).

usage: pack.py <root containing node_modules> <name> [shards=8] [schemes=single,shards,pkg]

  single  snap/<name>/single.tar.zst                one zstd tarball of node_modules
  shards  snap/<name>/shard-NN.tar.zst + shards.json  N independent tarballs, packages balanced
  pkg     pkg/<sha256>.tar.zst per package (content-addressed: identical package contents share
          one object across snapshots) + snap/<name>/manifest.json (path -> key) +
          snap/<name>/layout.tar.zst (everything not inside a package: .bin links, lock files)

A package is a directory with a package.json directly under a node_modules directory (or an
@scope under one); its object holds its files without its own nested node_modules. Tarballs are
deterministic (sorted, mtime 0, uid 0) so the same contents hash to the same key. Already
uploaded pkg objects are skipped (HEAD), which is the delta path.
"""
import hashlib
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, '/spike')
import r2io  # noqa: E402

root, name = sys.argv[1], sys.argv[2]
n_shards = int(sys.argv[3]) if len(sys.argv) > 3 else 8
schemes = (sys.argv[4] if len(sys.argv) > 4 else 'single,shards,pkg').split(',')
work = f'/mnt/ram/pack/{name}'
os.makedirs(work, exist_ok=True)
TAR = ['tar', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner']
ZSTD_LEVEL = os.environ.get('ZSTD_LEVEL', '3')
out = {'name': name, 'root': root}


def ms(t0):
    return round((time.perf_counter() - t0) * 1000)


def find_packages():
    """[(relpath, own_bytes, own_files)] and the layout entries (paths outside every package)."""
    pkgs = []
    nm_root = os.path.join(root, 'node_modules')
    stack = [nm_root]
    while stack:
        nm = stack.pop()
        for entry in sorted(os.listdir(nm)):
            p = os.path.join(nm, entry)
            if entry.startswith('@') and os.path.isdir(p) and not os.path.islink(p):
                cands = [os.path.join(p, e) for e in sorted(os.listdir(p))]
            else:
                cands = [p]
            for c in cands:
                if os.path.isdir(c) and not os.path.islink(c) and os.path.isfile(os.path.join(c, 'package.json')):
                    pkgs.append(os.path.relpath(c, root))
                    nested = os.path.join(c, 'node_modules')
                    if os.path.isdir(nested) and not os.path.islink(nested):
                        stack.append(nested)
    return pkgs


def own_entries(rel):
    """Every path of a package except its nested node_modules, relative to root."""
    base = os.path.join(root, rel)
    res = [rel]
    size = 0
    for dirpath, dirnames, filenames in os.walk(base):
        if dirpath == base and 'node_modules' in dirnames:
            dirnames.remove('node_modules')
        dirnames.sort()
        for d in dirnames:
            res.append(os.path.relpath(os.path.join(dirpath, d), root))
        for f in sorted(filenames):
            fp = os.path.join(dirpath, f)
            res.append(os.path.relpath(fp, root))
            if not os.path.islink(fp):
                size += os.path.getsize(fp)
    return res, size


def tar_list(paths, dest, cwd):
    lst = dest + '.list'
    with open(lst, 'w') as f:
        f.write('\n'.join(paths) + '\n')
    subprocess.run(f"{' '.join(TAR)} --no-recursion -C {cwd} -cf - -T {lst} | zstd -q -T0 -{ZSTD_LEVEL} -o {dest} -f", shell=True, check=True)
    os.remove(lst)
    return os.path.getsize(dest)


t0 = time.perf_counter()
pkgs = find_packages()
entries = {}
sizes = {}
for rel in pkgs:
    entries[rel], sizes[rel] = own_entries(rel)
covered = set()
for v in entries.values():
    covered.update(v)
layout = []
for dirpath, dirnames, filenames in os.walk(os.path.join(root, 'node_modules')):
    for x in sorted(dirnames) + sorted(filenames):
        rp = os.path.relpath(os.path.join(dirpath, x), root)
        if rp not in covered:
            layout.append(rp)
    # os.walk does not follow symlinked directories, so .bin links stay links.
out['packages'] = len(pkgs)
out['files'] = sum(len(v) for v in entries.values()) + len(layout)
out['raw_bytes'] = sum(sizes.values())
out['scan_ms'] = ms(t0)

if 'single' in schemes:
    t0 = time.perf_counter()
    dest = f'{work}/single.tar.zst'
    subprocess.run(f"{' '.join(TAR)} -C {root} -cf - node_modules | zstd -q -T0 -{ZSTD_LEVEL} -o {dest} -f", shell=True, check=True)
    out['single_bytes'] = os.path.getsize(dest)
    out['single_pack_ms'] = ms(t0)
    t0 = time.perf_counter()
    r2io.put_file(f'snap/{name}/single.tar.zst', dest)
    out['single_upload_ms'] = ms(t0)

if 'shards' in schemes:
    # Stable buckets: a package goes to bucket hash(package name) % N, so a lockfile change only
    # rewrites the buckets holding changed packages. Bucket objects are content-addressed
    # (chunk/<sha256>), so an unchanged bucket is never uploaded again. The layout (.bin links,
    # lock files, scope and nested node_modules dirs) changes with almost every lockfile change,
    # so it is its own small object.
    t0 = time.perf_counter()

    def pkg_name(rel):
        parts = rel.split('/')
        return '/'.join(parts[-2:]) if parts[-2].startswith('@') else parts[-1]

    bins = [[] for _ in range(n_shards)]
    load = [0] * n_shards
    for rel in pkgs:
        i = int(hashlib.sha1(pkg_name(rel).encode()).hexdigest(), 16) % n_shards
        bins[i].append(rel)
        load[i] += sizes[rel]

    def make_shard(i):
        paths = [p for rel in sorted(bins[i]) for p in entries[rel]]
        dest = f'{work}/shard-{i:02d}.tar.zst'
        size = tar_list(paths, dest, root)
        digest = hashlib.sha256(open(dest, 'rb').read()).hexdigest()
        return {'key': f'chunk/{digest}.tar.zst', 'bytes': size, 'packages': len(bins[i]), 'raw': load[i], 'file': dest}

    with ThreadPoolExecutor(2) as pool:
        shard_meta = list(pool.map(make_shard, range(n_shards)))
    lay = f'{work}/layout.tar.zst'
    lay_size = tar_list(layout, lay, root)
    lay_key = f'chunk/{hashlib.sha256(open(lay, "rb").read()).hexdigest()}.tar.zst'
    shard_meta.append({'key': lay_key, 'bytes': lay_size, 'packages': 0, 'raw': 0, 'file': lay, 'layout': True})
    out['shards_pack_ms'] = ms(t0)
    t0 = time.perf_counter()
    uploaded = 0
    for sm in shard_meta:
        f = sm.pop('file')
        if not r2io.exists(sm['key']):
            r2io.put_file(sm['key'], f)
            uploaded += sm['bytes']
    r2io.put_bytes(f'snap/{name}/shards.json', json.dumps(shard_meta).encode())
    out['shards_upload_ms'] = ms(t0)
    out['shards'] = [sm['bytes'] for sm in shard_meta]
    out['shards_bytes'] = sum(out['shards'])
    out['shards_uploaded_bytes'] = uploaded
    out['shards_keys'] = [sm['key'][6:18] for sm in shard_meta]

if 'pkg' in schemes:
    t0 = time.perf_counter()
    os.makedirs(f'{work}/pkg', exist_ok=True)

    def make_pkg(rel):
        base = os.path.join(root, rel)
        rels = [os.path.relpath(os.path.join(root, p), base) for p in entries[rel]]
        lst = f'{work}/pkg/{hashlib.sha1(rel.encode()).hexdigest()}.list'
        with open(lst, 'w') as f:
            f.write('\n'.join(rels) + '\n')
        data = subprocess.run(f"{' '.join(TAR)} --no-recursion -C {base} -cf - -T {lst} | zstd -q -{ZSTD_LEVEL} -c", shell=True, check=True, capture_output=True).stdout
        os.remove(lst)
        key = f'pkg/{hashlib.sha256(data).hexdigest()}.tar.zst'
        return rel, key, data

    with ThreadPoolExecutor(8) as pool:
        built = list(pool.map(make_pkg, pkgs))
    out['pkg_pack_ms'] = ms(t0)
    t0 = time.perf_counter()

    def upload(item):
        rel, key, data = item
        if r2io.exists(key):
            return 0
        r2io.put_bytes(key, data)
        return len(data)

    with ThreadPoolExecutor(16) as pool:
        uploaded = list(pool.map(upload, built))
    lay = f'{work}/layout.tar.zst'
    lay_size = tar_list(layout, lay, root)
    r2io.put_file(f'snap/{name}/layout.tar.zst', lay)
    manifest = [{'path': rel, 'key': key, 'bytes': len(data)} for rel, key, data in built]
    r2io.put_bytes(f'snap/{name}/manifest.json', json.dumps(manifest).encode())
    out['pkg_upload_ms'] = ms(t0)
    out['pkg_objects'] = len(built)
    out['pkg_unique_keys'] = len({k for _, k, _ in built})
    out['pkg_bytes'] = sum(len(d) for _, _, d in built)
    out['pkg_uploaded_bytes'] = sum(uploaded)
    out['pkg_uploaded_objects'] = sum(1 for u in uploaded if u > 0)
    out['pkg_layout_bytes'] = lay_size
    out['pkg_manifest_bytes'] = len(json.dumps(manifest))
    sz = sorted(len(d) for _, _, d in built)
    out['pkg_size_p50_p95_max'] = [sz[len(sz) // 2], sz[int(len(sz) * 0.95)], sz[-1]]

out['http_retries'] = r2io.RETRIES['n']
print(json.dumps(out))
