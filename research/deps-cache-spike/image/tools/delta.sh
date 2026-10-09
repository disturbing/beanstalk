#!/usr/bin/env bash
# Bytes to upload when one dependency changes, per scheme.
# delta.sh <built tree name under /mnt/ram/b> <npm install spec> <new snapshot name>
# Copies the built tree, changes one dependency with npm, repacks all three schemes (pkg and
# bucket objects already in R2 are skipped), and measures a zstd --patch-from delta of the
# single tarball against the previous one (the best a single-archive scheme can do).
set -eu
base=$1; spec=$2; new=$3
rm -rf /mnt/ram/d; mkdir -p /mnt/ram/d
cp -a /mnt/ram/b/$base /mnt/ram/d/$base
cd /mnt/ram/d/$base
npm install --ignore-scripts --no-audit --no-fund "$spec" > /tmp/delta-npm.log 2>&1
git_free_diff=$(diff <(cd /mnt/ram/b/$base && find node_modules -name package.json -path '*node_modules/*/package.json' -exec md5sum {} + | sort -k2) <(find node_modules -name package.json -path '*node_modules/*/package.json' -exec md5sum {} + | sort -k2) | grep -c '^[<>]' || true)
python3 /spike/pack.py /mnt/ram/d/$base $new 4
# zstd patch of the new single tar against the old one (long window so the old tar is in range).
old=/mnt/ram/pack/$base/single.tar.zst; newz=/mnt/ram/pack/$new/single.tar.zst
zstd -dc $old > /mnt/ram/old.tar; zstd -dc $newz > /mnt/ram/new.tar
oldsize=$(stat -c %s /mnt/ram/old.tar)
zstd -q -f --long=31 --patch-from=/mnt/ram/old.tar /mnt/ram/new.tar -o /mnt/ram/patch.zst
echo "{\"spec\":\"$spec\",\"package_json_lines_changed\":$git_free_diff,\"single_tar_bytes\":$oldsize,\"single_zst_bytes\":$(stat -c %s $newz),\"patch_from_bytes\":$(stat -c %s /mnt/ram/patch.zst)}"
rm -f /mnt/ram/old.tar /mnt/ram/new.tar /mnt/ram/patch.zst
