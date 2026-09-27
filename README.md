# lin

`lin` is a local-first web terminal distributed as one Linux executable. It serves a Vue/xterm.js interface and keeps login-shell-backed PTY sessions and terminal screens on the server.

## Requirements

Linux x86_64 or macOS arm64, GraalVM for JDK 25, Bun 1.4+, and a C compiler.
Linux builds require Linux PTY headers (`libc6-dev`). macOS builds require Xcode Command Line Tools.

## Run

```bash
./gradlew run
```

Open the tokenized URL printed by `lin`.

## Build

```bash
./gradlew test nativeCompile
./server/build/native/nativeCompile/lin
```

The Gradle project is split into two subprojects:

```text
:server  Java server, PTY shim, and native image
:web     Vue/xterm frontend
```

Gradle declares task dependencies and inputs/outputs. Shell scripts handle the build steps:

- `scripts/build-web.sh` installs frontend dependencies and builds the web assets.
- `scripts/build-pty-shim.sh [resource-directory]` detects the host platform, compiles the PTY library, and stages it under `native/<platform>/` for embedding. The default resource directory is `server/build/generated/pty-resources`; `CC` overrides the C compiler.

The native executable embeds the frontend and PTY shim; it does not require a JVM at runtime.

## Configuration

```text
lin [--host ADDRESS] [--port PORT] [--token TOKEN] [--allow-remote]
```

The same settings are available through environment variables:

```text
LIN_HOST           default: 127.0.0.1
LIN_PORT           default: 7681
LIN_TOKEN          random if unset
LIN_ALLOW_REMOTE  true/1/yes/on to enable
```

Command-line arguments override environment variables. Non-loopback binding requires explicit remote access (`--allow-remote` or `LIN_ALLOW_REMOTE`). TLS and a trusted reverse proxy are recommended for remote exposure; forward `X-Forwarded-Proto: https` so the auth cookie is marked `Secure`.

## Platform

The PTY shim supports Linux x86_64 and macOS arm64. Intel macOS is not supported.

## Session lifetime and restoration

Sessions and their creation order belong to the running server. Refreshing,
closing a browser window or disconnecting does not end a session. Opening the
same server again restores its tabs, screen, colors, cursor and recent history.
Only closing a terminal tab, exiting its shell or stopping lin ends the session.
The selected tab is a per-browser preference.

The server runs xterm headless in embedded GraalJS and retains up to 10,000
scrollback lines per terminal, plus its current normal/alternate screen. Output
continues to update this model while disconnected. The browser restores a
snapshot before consuming live output and retries interrupted connections.
History and sessions are in memory, not persisted across server restarts.
Multiple browser windows share the same session list and shell processes.

GraalJS is embedded in the native executable; no Node/Bun process is required at
runtime. This increases binary size and build/runtime memory compared to a
server that only forwards PTY bytes.

## Appearance

The UI follows Goblin's default macOS palette and compact toolbar styling.
Light, dark and system themes share CSS design tokens in `web/src/theme/`;
xterm reads the same tokens rather than maintaining a separate color palette.
See [the token contract](web/src/theme/README.md).
