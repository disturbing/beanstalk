#!/usr/bin/env bash
# What a build that touches every file pays: readtree.sh <dir> <label>
# After a page-cache drop: a stat walk (find, what module resolution does), then a full read of
# every file with 4 readers, then the same full read again (warm). One JSON line.
set -u
d=$1; label=$2
ms() { echo $(( ($(date +%s%N) - $1) / 1000000 )); }
sync; echo 3 > /proc/sys/vm/drop_caches
t=$(date +%s%N); n=$(find "$d" -type f | wc -l); s=$(ms $t)
sync; echo 3 > /proc/sys/vm/drop_caches
t=$(date +%s%N); find "$d" -type f -print0 | xargs -0 -P4 -n500 cat > /dev/null; c=$(ms $t)
t=$(date +%s%N); find "$d" -type f -print0 | xargs -0 -P4 -n500 cat > /dev/null; w=$(ms $t)
echo "{\"label\":\"$label\",\"fs\":\"$(stat -f -c %T "$d")\",\"files\":$n,\"stat_walk_cold_ms\":$s,\"read_all_cold_ms\":$c,\"read_all_warm_ms\":$w}"
