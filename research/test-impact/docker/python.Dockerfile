FROM python:3.13-slim-trixie
RUN apt-get update && apt-get install -y --no-install-recommends strace && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir pytest==8.4.2
