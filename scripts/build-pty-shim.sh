#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source_file="$project_dir/server/src/main/c/linpty.c"
output_dir="${LIN_NATIVE_OUTPUT_DIR:-$project_dir/build/native}"
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
    "$source_file" \
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
  "$source_file" \
  -Wl,-soname,liblinpty.so \
  -lutil \
  -o "$output_dir/liblinpty.so"
