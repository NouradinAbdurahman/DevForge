#!/usr/bin/env bash
# Example plugin hook script, registered as `devforgekit hello` by
# cli/src/core/plugins.js. Proves that a plugin.yml command hook can run
# arbitrary shell (or any executable) end-to-end - see plugin.yml and
# docs/PlatformArchitecture.md section 4.
set -Eeuo pipefail

echo "Hello from the DevForgeKit hello-world plugin!"
