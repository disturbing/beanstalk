# DinD probe, run inside the spike container as root (run.py --exec-file probes/dind.sh).
if ! docker info >/dev/null 2>&1; then
  (dockerd --iptables=false --ip6tables=false --ip-forward=false > /tmp/dockerd.log 2>&1 &)
  for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
  echo "--- dockerd up after ${i}s"
fi
docker info 2>&1 | grep -E "Server Version|Storage Driver|Cgroup Version"
echo "--- default bridge network (no iptables): inner egress?"
docker run --rm alpine:3.20 sh -c "ip -4 addr show eth0 | grep inet; wget -qO- -T 5 http://example.com | head -c 40" 2>&1 | tail -3
echo
echo "--- docker build"
mkdir -p /tmp/b && printf 'FROM alpine:3.20\nRUN echo built > /x\nCMD cat /x\n' > /tmp/b/Dockerfile
start=$(date +%s.%N); docker build -q -t spike-b /tmp/b 2>&1 | tail -2; docker run --rm spike-b
echo "build+run $(echo "$(date +%s.%N) - $start" | bc 2>/dev/null || true)s"
echo "--- redis, host network"
docker run -d --name r --network=host redis:7-alpine >/dev/null
sleep 2
(exec 3<>/dev/tcp/127.0.0.1/6379 && printf 'PING\r\n' >&3 && timeout 3 head -c 7 <&3) || echo no-redis-host
echo
echo "--- redis, bridge + -p 6380:6379"
docker run -d --name r2 -p 6380:6379 redis:7-alpine 2>&1 | tail -1
sleep 2
(exec 3<>/dev/tcp/127.0.0.1/6380 && printf 'PING\r\n' >&3 && timeout 3 head -c 7 <&3) || echo no-redis-bridge-port
echo
docker rm -f r r2 >/dev/null 2>&1
echo "--- user namespaces"
unshare --user --map-root-user true && echo userns-ok || echo userns-refused
echo "--- postgres 16, host network"
start=$(date +%s)
docker run -d --name pg --network=host -e POSTGRES_PASSWORD=spike postgres:16-alpine >/dev/null
for i in $(seq 1 60); do docker exec pg pg_isready -q 2>/dev/null && break; sleep 1; done
docker exec pg psql -U postgres -tAc 'select version()' | head -c 60; echo
echo "postgres ready in $(( $(date +%s) - start ))s (pull included)"
docker rm -f pg >/dev/null 2>&1
