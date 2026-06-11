#!/bin/sh
# Single source of truth for dev ports + the saas→workflows trigger URL.
# Change these three when another project squats 3000/3001 on your machine.
export SAAS_PORT=3010
export WORKFLOWS_PORT=3011
export WORKFLOW_TRIGGER_URL="http://localhost:${WORKFLOWS_PORT}/api"

agent-tail init
exec turbo dev "$@"
