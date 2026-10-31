#!/usr/bin/env bash
# Install the factory's project-side footprint into a target repository.
#   ./install.sh [--dry-run] [--preset python-uv|node-npm] <target-repo>
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null; then echo "error: node 20 or newer is required" >&2; exit 2; fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then echo "error: node 20 or newer is required, found $(node --version)" >&2; exit 2; fi
exec node "$here/install/install.mjs" "$@"
