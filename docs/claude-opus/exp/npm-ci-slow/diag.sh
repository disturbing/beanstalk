#!/bin/bash
# diag.sh env | net | run <label> <placement disk|tmpfs> <cache cold|warm> [npm ci flags...]
set -u
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
ms() { date +%s%3N; }

case "$1" in
env)
  echo "== env"
  nproc; grep -m1 'model name' /proc/cpuinfo; grep -E 'MemTotal|MemAvailable' /proc/meminfo
  uname -r; node --version; npm --version
  df -h "$root" /tmp | sed 1d
  echo "-- resolv.conf"; cat /etc/resolv.conf
  echo "-- addresses"; ip -br addr 2>/dev/null || hostname -I
  echo "-- routes v6"; ip -6 route 2>/dev/null | head -5
  echo "-- npm config"; npm config get registry maxsockets fetch-retries prefer-online audit fund
  env | grep -i '^npm_config' || true
  env | grep -iE '^(npm_config|http_proxy|https_proxy|no_proxy)' | sed -E 's/(_authToken|token)=.*/\1=***/' || true
  ;;
net)
  echo "== net"
  for i in 1 2 3; do
    t0=$(ms); getent ahosts registry.npmjs.org | head -3; echo "getent ahosts #$i $(( $(ms) - t0 )) ms"
  done
  node -e 'const d=require("dns");let t=Date.now();d.lookup("registry.npmjs.org",{all:true},(e,a)=>console.log("node dns.lookup",Date.now()-t,"ms",JSON.stringify(a)))'
  echo "-- trace"; curl -s https://registry.npmjs.org/cdn-cgi/trace | grep -E '^(ip|colo|loc|http|tls)='
  fmt='%{http_version} ip=%{remote_ip} dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} bytes=%{size_download} speed=%{speed_download}\n'
  for v in 4 6; do
    echo "-- IPv$v"
    curl -s -$v -o /dev/null -w "packument fastify $fmt" https://registry.npmjs.org/fastify || echo "IPv$v failed"
    curl -s -$v -o /dev/null -w "tarball typescript $fmt" https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz || echo "IPv$v failed"
  done
  curl -s -o /dev/null -w "packument typescript (15 MB) $fmt" https://registry.npmjs.org/typescript
  curl -s -o /dev/null -w "packument @typescript-eslint/parser $fmt" 'https://registry.npmjs.org/@typescript-eslint%2fparser'
  echo "-- every tarball in the lockfile, 16 at a time (no npm)"
  node -e 'const l=require(process.argv[1]);for(const p of Object.values(l.packages))if(p.resolved)console.log(p.resolved)' "$root/package-lock.json" > /tmp/urls.txt
  t0=$(ms)
  xargs -P 16 -n 1 curl -s -o /dev/null -w '%{time_total}\n' < /tmp/urls.txt > /tmp/times.txt
  echo "curl $(wc -l < /tmp/urls.txt) tarballs: $(( $(ms) - t0 )) ms wall; per request p50/p90/max s: $(sort -n /tmp/times.txt | awk '{a[NR]=$1} END {print a[int(NR*0.5)], a[int(NR*0.9)], a[NR]}')"
  ;;
run)
  label=$2 placement=$3 cache=$4; shift 4
  cd "$root"
  sudo umount "$root/node_modules" 2>/dev/null; sudo umount /tmp/npm-cache 2>/dev/null
  rm -rf "$root/node_modules"
  if [ "$cache" = cold ]; then rm -rf /tmp/npm-cache; fi
  mkdir -p "$root/node_modules" /tmp/npm-cache
  if [ "$placement" = tmpfs ]; then
    sudo mount -t tmpfs -o size=4g,mode=0755,uid=$(id -u),gid=$(id -g) tmpfs "$root/node_modules"
    if [ "$cache" = cold ]; then sudo mount -t tmpfs -o size=2g,mode=0755,uid=$(id -u),gid=$(id -g) tmpfs /tmp/npm-cache; fi
  fi
  rm -rf /tmp/npm-cache/_logs
  sync; echo 3 | sudo tee /proc/sys/vm/drop_caches >/dev/null
  t0=$(ms)
  TIMEFORMAT="cpu user=%U s sys=%S s real=%R s"
  { time npm ci --cache /tmp/npm-cache --timing --loglevel=http "$@" > "/tmp/npm-$label.log" 2>&1 ; } 2> /tmp/time.txt
  code=$?
  cat /tmp/time.txt
  wall=$(( $(ms) - t0 ))
  grep -E '^(added|npm error|npm warn)' "/tmp/npm-$label.log" | head -5
  echo "exit $code"
  node "$here/summary.mjs" "$label" "$wall" /tmp/npm-cache
  ;;
esac
