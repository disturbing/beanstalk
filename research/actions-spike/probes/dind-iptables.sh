# Does dockerd start with its default iptables/ip-forward handling, and do bridge containers get
# egress then? Run on a fresh instance (no dockerd yet).
sysctl net.ipv4.ip_forward
(dockerd > /tmp/dockerd.log 2>&1 &)
for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
if docker info >/dev/null 2>&1; then echo "dockerd (default flags) up after ${i}s"; else echo "dockerd (default flags) failed"; tail -8 /tmp/dockerd.log; fi
sysctl net.ipv4.ip_forward
iptables -t nat -S 2>&1 | head -5
docker run --rm alpine:3.20 sh -c "wget -qO- -T 5 http://example.com | head -c 40" 2>&1 | tail -3
echo
echo "--- user-defined bridge: name resolution between containers"
docker network create spikenet >/dev/null
docker run -d --name spike-redis --network spikenet redis:7-alpine >/dev/null
sleep 2
docker run --rm --network spikenet redis:7-alpine redis-cli -h spike-redis ping
docker rm -f spike-redis >/dev/null; docker network rm spikenet >/dev/null
