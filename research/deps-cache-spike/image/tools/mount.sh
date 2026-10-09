#!/usr/bin/env bash
# Can node_modules be a compressed read-only image kept IN RAM (tmpfs) and mounted?
# mount.sh <root containing node_modules> <label>
# Builds SquashFS (zstd, lz4) and EROFS (lz4hc) images on the tmpfs, then tries the kernel mount
# (loop) and the FUSE mounts, and measures image size, mount time, a cold full read through each
# mount against the extracted tree on tmpfs, and memory (Shmem = tmpfs bytes, Cached = page cache).
set -u
src=$1/node_modules; label=$2
img=/mnt/ram/img; mkdir -p $img
mnt=/mnt/m; mkdir -p $mnt
ms() { echo $(( ($(date +%s%N) - $1) / 1000000 )); }
mem() { awk '/MemAvailable|^Shmem:|^Cached/ {printf "%s=%d ", $1, $2/1024}' /proc/meminfo; }
readall() { sync; echo 3 > /proc/sys/vm/drop_caches; local t=$(date +%s%N); find "$1" -type f -print0 | xargs -0 -P4 -n500 cat > /dev/null; echo "$(ms $t)"; }
raw=$(du -sb "$src" | cut -f1); nfiles=$(find "$src" | wc -l)
echo "{\"label\":\"$label\",\"raw_bytes\":$raw,\"entries\":$nfiles,\"tmpfs_full_read_ms\":$(readall "$src")}"
try() { # name, image-build cmd, mount cmd, umount cmd
  local name=$1 build=$2 mountc=$3 umountc=$4 t b m out rd ok
  rm -f $img/$name.img
  t=$(date +%s%N); bash -c "$build" > /tmp/build-$name.log 2>&1; b=$(ms $t)
  [ -f $img/$name.img ] || { echo "{\"img\":\"$name\",\"build\":\"failed\",\"log\":\"$(tail -c 200 /tmp/build-$name.log | tr '\n"' ' ')\"}"; return; }
  local before; before=$(mem)
  t=$(date +%s%N); out=$(bash -c "$mountc" 2>&1); ok=$?; m=$(ms $t)
  if [ $ok -ne 0 ] || [ -z "$(ls -A $mnt 2>/dev/null)" ]; then
    echo "{\"img\":\"$name\",\"img_bytes\":$(stat -c %s $img/$name.img),\"build_ms\":$b,\"mount\":\"refused\",\"error\":\"$(echo "$out" | tr '\n"' ' ' | cut -c1-200)\"}"
    bash -c "$umountc" 2>/dev/null; return
  fi
  rd=$(readall $mnt)
  local same=yes; diff -rq --no-dereference "$src" $mnt > /tmp/diff-$name.txt 2>&1 || same="no ($(wc -l < /tmp/diff-$name.txt) diffs)"
  echo "{\"img\":\"$name\",\"img_bytes\":$(stat -c %s $img/$name.img),\"build_ms\":$b,\"mount_ms\":$m,\"full_read_cold_ms\":$rd,\"identical\":\"$same\",\"mem_before\":\"$before\",\"mem_after_read\":\"$(mem)\"}"
  bash -c "$umountc"
}
try sqfs-zstd "mksquashfs $src $img/sqfs-zstd.img -comp zstd -Xcompression-level 3 -processors 4 -noappend -quiet" "mount -t squashfs -o loop,ro $img/sqfs-zstd.img $mnt" "umount $mnt"
try sqfs-lz4 "mksquashfs $src $img/sqfs-lz4.img -comp lz4 -processors 4 -noappend -quiet" "mount -t squashfs -o loop,ro $img/sqfs-lz4.img $mnt" "umount $mnt"
try sqfs-zstd-fuse "cp $img/sqfs-zstd.img $img/sqfs-zstd-fuse.img" "squashfuse $img/sqfs-zstd-fuse.img $mnt" "fusermount3 -u $mnt || umount $mnt"
try erofs-lz4hc "mkfs.erofs -zlz4hc $img/erofs-lz4hc.img $src" "mount -t erofs -o loop,ro $img/erofs-lz4hc.img $mnt" "umount $mnt"
try erofs-fuse "cp $img/erofs-lz4hc.img $img/erofs-fuse.img" "erofsfuse $img/erofs-fuse.img $mnt" "fusermount3 -u $mnt || umount $mnt"
# Writable view: overlayfs with a tmpfs upper layer over the read-only squashfs.
mount -t squashfs -o loop,ro $img/sqfs-zstd.img /mnt/m && mkdir -p /mnt/ram/ov/up /mnt/ram/ov/work /mnt/ov && \
  mount -t overlay overlay -o lowerdir=/mnt/m,upperdir=/mnt/ram/ov/up,workdir=/mnt/ram/ov/work /mnt/ov && \
  touch /mnt/ov/.write-test && echo "{\"overlay_on_squashfs\":\"writable\"}" ; umount /mnt/ov 2>/dev/null; umount /mnt/m 2>/dev/null; rm -rf /mnt/ram/ov
