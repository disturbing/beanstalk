#!/usr/bin/env bash
# Sequential write and read of one large file on a directory: bigfile.sh <dir> <GiB>
# Buffered write + fdatasync, then page-cache drop and a cold buffered read (what tar or a
# loop/FUSE mount would do), then O_DIRECT read and 4 KiB random reads with fio on the same file
# (O_DIRECT is skipped on tmpfs, which has no device). One JSON line out.
set -eu
dir=$1; gib=${2:-2}; f=$dir/bigfile.bin
mkdir -p "$dir"; rm -f "$f"
fstype=$(stat -f -c %T "$dir")
ms() { echo $(( ($(date +%s%N) - $1) / 1000000 )); }
# Incompressible source kept in RAM so the source never limits the write.
mkdir -p /mnt/src; mountpoint -q /mnt/src && umount /mnt/src; mount -t tmpfs -o size=$((gib + 1))g tmpfs /mnt/src
[ -f /mnt/src/rand.bin ] && [ "$(stat -c %s /mnt/src/rand.bin)" -eq $((gib * 1073741824)) ] || \
  head -c $((gib * 1073741824)) /dev/urandom > /mnt/src/rand.bin
sync; echo 3 > /proc/sys/vm/drop_caches
t=$(date +%s%N); dd if=/mnt/src/rand.bin of="$f" bs=4M conv=fdatasync status=none; w=$(ms $t)
sync; echo 3 > /proc/sys/vm/drop_caches
direct1=null
[ "$fstype" != tmpfs ] && { t=$(date +%s%N); dd if="$f" of=/dev/null bs=4M iflag=direct status=none; direct1=$(( gib * 1024 * 1000 / $(ms $t) )); }
sync; echo 3 > /proc/sys/vm/drop_caches
t=$(date +%s%N); dd if="$f" of=/dev/null bs=4M status=none; r=$(ms $t)
t=$(date +%s%N); dd if="$f" of=/dev/null bs=4M status=none; rw=$(ms $t)
direct=null; rand=null
if [ "$fstype" != tmpfs ]; then
  direct=$(fio --name=sr --filename="$f" --rw=read --bs=1M --direct=1 --ioengine=libaio --iodepth=16 --size=${gib}G --readonly --output-format=json | python3 -c 'import json,sys; j=json.load(sys.stdin)["jobs"][0]["read"]; print(round(j["bw_bytes"]/1048576))')
  rand=$(fio --name=rr --filename="$f" --rw=randread --bs=4k --direct=1 --ioengine=libaio --iodepth=1 --runtime=10 --time_based --size=${gib}G --readonly --output-format=json | python3 -c 'import json,sys; j=json.load(sys.stdin)["jobs"][0]["read"]; print(round(j["iops"]))')
  rand32=$(fio --name=rr --filename="$f" --rw=randread --bs=4k --direct=1 --ioengine=libaio --iodepth=32 --runtime=10 --time_based --size=${gib}G --readonly --output-format=json | python3 -c 'import json,sys; j=json.load(sys.stdin)["jobs"][0]["read"]; print(round(j["iops"]))')
  rand="{\"qd1_iops\":$rand,\"qd32_iops\":$rand32}"
fi
rm -f "$f"
mib=$((gib * 1024))
echo "{\"dir\":\"$dir\",\"fs\":\"$fstype\",\"gib\":$gib,\"write_ms\":$w,\"write_mibs\":$((mib * 1000 / w)),\"read_cold_ms\":$r,\"read_cold_mibs\":$((mib * 1000 / r)),\"read_warm_ms\":$rw,\"direct_first_read_mibs\":$direct1,\"fio_direct_read_mibs\":$direct,\"rand4k\":$rand}"
