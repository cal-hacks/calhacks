#!/usr/bin/env sh
# Production entry point (Render): the Fetch agents and chat watcher run in the
# background; the web server takes the port Render routes traffic to.
set -e
uv run --no-dev python -m agent_service.fetch_agents &
exec uv run --no-dev uvicorn agent_service.main:app --host 0.0.0.0 --port "${PORT:-8000}"
