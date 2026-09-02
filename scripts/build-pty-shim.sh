#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
output_dir="$project_dir/build/native"
mkdir -p "$output_dir"

gcc \
  -std=c17 \
  -O2 \
  -fPIC \
  -Wall \
  -Wextra \
  -Werror \
  -shared \
  "$project_dir/src/main/c/linpty.c" \
  -Wl,-soname,liblinpty.so \
  -lutil \
  -o "$output_dir/liblinpty.so"
