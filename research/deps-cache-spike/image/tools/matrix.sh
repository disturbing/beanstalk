#!/usr/bin/env bash
# Restore matrix for one packed tree: matrix.sh <name> <epoch-tag> [schemes] [layers]
# Each (scheme, layer) runs cold (new cache epoch) then warm (same epoch). Destination is a fresh
# directory on the tmpfs /mnt/ram; one extra single-tarball restore goes to the ext4 disk.
set -u
name=$1; tag=$2
schemes=${3:-single shards pkg-node}
layers=${4:-r2 api wc}
mountpoint -q /mnt/ram || mount -t tmpfs -o size=11g tmpfs /mnt/ram
run() {
  rm -rf "$5"; sync; echo 3 > /proc/sys/vm/drop_caches
  if [ "$2" = pkg-node ]; then node /spike/restore-pkg.mjs "$1" "$3" "$4" "$5" ${6:-16}; else python3 /spike/restore.py "$1" "$2" "$3" "$4" "$5" ${6:-}; fi
  rm -rf "$5"
}
run "$name" dl-single r2 x /mnt/ram/r
for s in $schemes; do
  for l in $layers; do
    ep="$tag-$s"
    run "$name" "$s" "$l" "$ep" /mnt/ram/r
    [ "$l" != r2 ] && run "$name" "$s" "$l" "$ep" /mnt/ram/r
  done
done
run "$name" single r2 x /work/r
