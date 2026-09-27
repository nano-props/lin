#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_dir/web"

bun install --frozen-lockfile
bun run build

bun build server/terminal-state.js --target=browser --format=iife --outfile=server-dist/terminal-state.js
