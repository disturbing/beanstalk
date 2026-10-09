#!/usr/bin/env bash
# One-package change on the 3 GiB synthetic tree: delta-synth.sh
# Edits one file in one package, repacks as synth-d1 (unchanged pkg and bucket objects are
# skipped by HEAD), and tries a zstd --patch-from delta of the single tarball. The tarballs for
# the patch go to the ext4 disk (/work) only because two 3.3 GB tars do not fit next to the tree
# in 12 GiB; this measures bytes, not speed.
set -u
curl -sfS http://deps.internal/r2/snap/synth/single.tar.zst | zstd -dc > /work/old.tar
echo "// changed $(date +%s)" >> /mnt/ram/b/synth/node_modules/syn-02001/lib/f001.js
python3 /spike/pack.py /mnt/ram/b/synth synth-d1 16
zstd -dc /mnt/ram/pack/synth-d1/single.tar.zst > /work/new.tar
rm -rf /mnt/ram/pack/synth-d1
t=$(date +%s%N)
if zstd -q -f -T0 --long=31 --patch-from=/work/old.tar /work/new.tar -o /work/patch.zst 2> /tmp/patch.err; then
  echo "{\"old_tar_bytes\":$(stat -c %s /work/old.tar),\"patch_from_bytes\":$(stat -c %s /work/patch.zst),\"patch_ms\":$(( ($(date +%s%N) - t) / 1000000 ))}"
else
  echo "{\"patch_from\":\"failed\",\"error\":\"$(tr '\n"' ' ' < /tmp/patch.err | cut -c1-200)\"}"
fi
rm -f /work/old.tar /work/new.tar /work/patch.zst
