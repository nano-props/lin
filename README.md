# lin

A small, local-first web terminal distributed as one Linux executable.

`lin` serves a clipped Goblin-style Vue 3 + TSX interface: its toolbar tab and tooltip primitives are migrated from Goblin, with Reka UI, VueUse, Lucide, and xterm.js. It opens one PTY-backed login shell per browser tab and starts every shell in the current user's home directory. The server is Java 25; Linux PTY calls use the Foreign Function & Memory API and a tiny embedded C shim. GraalVM Native Image packages the server, web assets, and shim into one executable.

## Features

- Multiple independent terminal tabs
- New/close/switch shortcuts (`Ctrl/⌘ T`, `Ctrl/⌘ W`, `Ctrl/⌘ 1…9`)
- Terminal search (`Ctrl/⌘ Shift+F`), resize, scrollback, ANSI colors, and OSC title updates
- Login shell rooted at `$HOME`
- Loopback-only binding and a random access token by default
- Local token entry screen when opened without a tokenized URL
- WebSocket token and same-origin checks
- HttpOnly/SameSite cookie authentication (Secure is enabled for HTTPS requests)
- Single-file Linux x86_64 distribution

## Run from source

Requirements: GraalVM for JDK 25, Bun 1.4+, GCC, and Linux PTY headers (`libc6-dev`).

```bash
./gradlew run
```

Open the tokenized URL printed by the process.

The frontend dependency install and production build stay in Bun and shell scripts; Gradle only invokes that build and embeds the resulting static assets.

## Build

```bash
./gradlew test nativeCompile
./build/native/nativeCompile/lin
```

The generated executable does not require a JVM. It embeds `liblinpty.so` and extracts that library into a private temporary directory while running.

## Options

```text
lin [--host ADDRESS] [--port PORT] [--token TOKEN] [--allow-remote]
```

The default address is `127.0.0.1:7681`. Binding a non-loopback address requires `--allow-remote`; access-token protection remains enabled. TLS and a trusted reverse proxy are strongly recommended for any remote exposure.
When using an HTTPS reverse proxy, forward `X-Forwarded-Proto: https` so lin marks the authentication cookie `Secure`.

## Current platform scope

The PTY shim currently targets Linux x86_64. macOS and Windows require separate native implementations and release builds.
