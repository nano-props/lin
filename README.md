# lin

`lin` is a local-first web terminal distributed as one Linux executable. It serves a Vue/xterm.js interface and starts one login-shell-backed PTY per browser tab.

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

The Gradle project is split into two subprojects:

```text
:server  Java server, PTY shim, and native image
:web     Vue/xterm frontend
```
```

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
