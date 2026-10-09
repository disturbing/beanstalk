#!/usr/bin/env bash
# What the container is: CPUs, memory, disks, filesystems, privileges, mount ability.
set -u
sec() { echo "=== $1"; }
sec kernel; uname -a
sec cpus; nproc; grep -m1 'model name' /proc/cpuinfo
sec meminfo; grep -E 'MemTotal|MemFree|MemAvailable|Shmem:|SwapTotal|^Cached' /proc/meminfo
sec cgroup; cat /proc/self/cgroup; for f in memory.max memory.current memory.peak memory.swap.max; do printf '%s: ' $f; cat /sys/fs/cgroup/$f 2>&1; done
sec df; df -hT / /tmp /dev/shm 2>&1
sec mounts; cat /proc/mounts
sec blockdevs; lsblk -o NAME,SIZE,TYPE,ROTA,MOUNTPOINT 2>&1 | head -20; cat /sys/block/*/queue/scheduler 2>/dev/null | head
sec filesystems; cat /proc/filesystems | tr '\n' ' '; echo
sec modules; ls /lib/modules 2>&1 | head; cat /proc/modules 2>&1 | head -5
sec caps; grep -E 'Cap(Inh|Prm|Eff|Bnd|Amb)' /proc/self/status; capsh --print 2>&1 | grep -E 'Current|Bounding' | head -3
sec whoami; id
sec devices; ls -l /dev/fuse /dev/loop-control /dev/loop* 2>&1 | head; ls /dev | tr '\n' ' '; echo
sec seccomp; grep -E 'Seccomp|NoNewPrivs' /proc/self/status
sec tmpfs-mount; mkdir -p /mnt/probe && mount -t tmpfs -o size=1g tmpfs /mnt/probe && echo OK tmpfs mount && df -h /mnt/probe && umount /mnt/probe
sec loop; losetup -f 2>&1; modprobe loop 2>&1 | head -2
sec drop-caches; sync; echo 3 > /proc/sys/vm/drop_caches && echo OK drop_caches
sec sysctl; sysctl vm.dirty_ratio vm.dirty_background_ratio vm.swappiness 2>&1
