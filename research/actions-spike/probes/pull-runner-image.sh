# How long does pulling act's medium Ubuntu runner image take inside the container (DinD)?
docker info >/dev/null 2>&1 || { (dockerd > /tmp/dockerd.log 2>&1 &); for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done; }
start=$(date +%s)
docker pull -q catthehacker/ubuntu:act-24.04
echo "pull catthehacker/ubuntu:act-24.04: $(( $(date +%s) - start ))s"
docker image ls catthehacker/ubuntu:act-24.04 --format '{{.Size}}'
df -h / | tail -1
