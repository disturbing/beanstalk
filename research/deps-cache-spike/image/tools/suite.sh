#!/usr/bin/env bash
# fastify's own suite and TypeScript checks with the checkout + node_modules placed on:
#   ram   tmpfs (/mnt/ram)               disk  ext4 container disk (/work), page cache dropped
#   sqfs  tmpfs checkout, node_modules = kernel SquashFS mount of an image held on tmpfs
# suite.sh <placement> [steps]   steps: first unit types (default all)
# The built tree is /mnt/ram/b/fastify (npm ci --ignore-scripts at the arena lockfile).
set -u
place=$1; steps=${2:-first unit types}
ms() { echo $(( ($(date +%s%N) - $1) / 1000000 )); }
case $place in
  ram) dir=/mnt/ram/s/fastify ;;
  disk) dir=/work/s/fastify ;;
  sqfs) dir=/mnt/ram/q/fastify ;;
esac
umount $dir/node_modules 2>/dev/null; rm -rf "$(dirname $dir)"; mkdir -p "$(dirname $dir)"
t=$(date +%s%N)
if [ $place = sqfs ]; then
  mkdir -p $dir && (cd /mnt/ram/b/fastify && tar --exclude=./node_modules -cf - .) | tar -xf - -C $dir
  mkdir -p /mnt/ram/img $dir/node_modules
  [ -f /mnt/ram/img/fastify-suite.img ] || mksquashfs /mnt/ram/b/fastify/node_modules /mnt/ram/img/fastify-suite.img -comp zstd -Xcompression-level 3 -processors 4 -noappend -quiet
  mount -t squashfs -o loop,ro /mnt/ram/img/fastify-suite.img $dir/node_modules
else
  cp -a /mnt/ram/b/fastify $dir
fi
place_ms=$(ms $t)
sync; echo 3 > /proc/sys/vm/drop_caches
cd $dir
res="{\"placement\":\"$place\",\"place_ms\":$place_ms"
for s in $steps; do
  t=$(date +%s%N)
  case $s in
    first) node --test test/404s.test.js > /tmp/first.log 2>&1; rc=$? ;;
    unit) npx borp --reporter=dot > /tmp/unit.log 2>&1; rc=$? ;;
    types) npm run test:typescript > /tmp/types.log 2>&1; rc=$? ;;
  esac
  res="$res,\"${s}_ms\":$(ms $t),\"${s}_rc\":$rc"
done
tests=$(grep -Eo '^# (pass|fail) [0-9]+' /tmp/unit.log 2>/dev/null | tr '\n' ' ')
echo "$res,\"unit_summary\":\"$tests\"}"
cd /; umount $dir/node_modules 2>/dev/null; rm -rf "$(dirname $dir)"
