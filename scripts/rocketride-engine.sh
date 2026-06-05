#!/usr/bin/env bash
# Reproducibly start the RocketRide engine wired to the Butterbase AI gateway.
# Fixes the stock image's gaps: missing /opt/data, missing jmespath, and routes
# the LLM nodes to Butterbase via OPENAI_BASE_URL. Run from the repo root with
# .env sourced:  set -a; source .env; set +a; ./scripts/rocketride-engine.sh
set -euo pipefail
GW="https://api.butterbase.ai/v1/${NEXT_PUBLIC_BUTTERBASE_APP_ID}"
docker rm -f rocketride-engine >/dev/null 2>&1 || true
docker run -d --name rocketride-engine -p 5565:5565 \
  -e OPENAI_BASE_URL="$GW" -e OPENAI_API_KEY="$BUTTERBASE_SERVICE_KEY" \
  ghcr.io/rocketride-org/rocketride-engine:latest
echo "waiting for first-boot bootstrap (amd64 emulation is slow)…"
CID=$(docker ps -q --filter ancestor=ghcr.io/rocketride-org/rocketride-engine:latest | head -1)
for i in $(seq 1 20); do sleep 10; docker logs "$CID" 2>&1 | grep -qiE "Application startup complete|Uvicorn running" && break; done
docker exec -u root "$CID" sh -c 'mkdir -p /opt/data && chown -R 999:999 /opt/data && chmod -R 775 /opt/data'
docker exec -u rocketride "$CID" /opt/rocketride/bin/uv pip install --target /opt/rocketride/lib/python3.12/site-packages jmespath >/dev/null 2>&1
echo "RocketRide engine ready on :5565 (LLM → Butterbase gateway)."
