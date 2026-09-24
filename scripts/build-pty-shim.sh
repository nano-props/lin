#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
output_dir="$project_dir/build/native"
mkdir -p "$output_dir"

if [[ "$(uname -s)" == "Darwin" ]]; then
  if [[ "$(uname -m)" != "arm64" ]]; then
    echo "macOS arm64 is the only supported macOS target" >&2
    exit 1
  fi

  cc="${CC:-clang}"
  "$cc" \
    -std=c17 \
    -O2 \
    -fPIC \
    -Wall \
    -Wextra \
    -Werror \
    -dynamiclib \
    "$project_dir/src/main/c/linpty.c" \
    -install_name "@rpath/liblinpty.dylib" \
    -o "$output_dir/liblinpty.dylib"
  exit 0
fi

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
