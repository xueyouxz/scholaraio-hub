#!/bin/sh
set -eu

# Sync the locked runtime after image upgrades, keeping optional capabilities.
pnpm hub setup --production
exec "$@"
