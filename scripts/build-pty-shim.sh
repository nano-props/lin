#!/usr/bin/env bash
set -Eeuo pipefail

trap 'printf "build-pty-shim: failed at line %d\n" "$LINENO" >&2' ERR

fail() {
  printf 'build-pty-shim: %s\n' "$1" >&2
  exit 1
}

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source_file="$project_dir/server/src/main/c/linpty.c"
resource_dir="${1:-$project_dir/server/build/generated/pty-resources}"

[[ -f "$source_file" ]] || fail "native source file is missing: $source_file"

os=$(uname -s)
arch=$(uname -m)

case "$os:$arch" in
  Darwin:arm64)
  output_dir="$resource_dir/native/macos-aarch64"
  mkdir -p "$output_dir"
  cc="${CC:-clang}"
  command -v "$cc" >/dev/null 2>&1 || fail "C compiler not found: $cc"
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
  ;;
  Linux:x86_64)
  output_dir="$resource_dir/native/linux-x86_64"
  mkdir -p "$output_dir"
  cc="${CC:-gcc}"
  command -v "$cc" >/dev/null 2>&1 || fail "C compiler not found: $cc"
  "$cc" \
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
  ;;
  *)
  fail "unsupported target: $os $arch; supported targets are Linux x86_64 and macOS arm64"
  ;;
esac

printf 'build-pty-shim: built %s\n' "$output_dir"
