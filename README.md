# lin

`lin` is a local-first web terminal distributed as one executable. It serves a Vue/xterm.js interface and keeps login-shell-backed PTY sessions and terminal screens on the server.

## Requirements

Bun 1.4.2 or newer on Linux x86_64 or macOS arm64. No Java or C toolchain is required.

## Run

```bash
bun install --frozen-lockfile
bun run dev
```

This builds the frontend and starts the Bun + Hono server. Open the tokenized URL
printed by `lin`. After the frontend is built, `bun run start` starts just the server.
Use `bun run --cwd web dev` for the standalone Vite frontend development server.

## Build and test

```bash
bun run check
bun test
bun run build
./dist/lin
```

`bun run build` builds the Vue frontend and compiles the server with its static
assets into one executable. The executable runs without Bun installed and can be
started from any working directory. Build on the target platform.

The repository is a Bun workspace:

- `server/src`: Hono routes, Bun WebSocket/PTY sessions, and the xterm screen model.
- `server/test`: configuration, protocol, screen restoration, and real PTY/WebSocket tests.
- `web`: Vue/xterm frontend, built with Vite.
- `scripts/build.ts`: embeds the frontend assets and compiles `dist/lin`.

HTTP parsing and WebSocket framing are handled by Bun. Hono handles routing and
cookies. Bun's built-in PTY API starts the login shell and handles input, output,
resizing, and teardown.

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

Login has no server-side time limit. The browser remembers it with a 400-day
cookie, renewed on authenticated API requests (including the session-list poll).
Clearing browser cookies, exceeding the browser's storage lifetime, or changing
the server token requires logging in again. Set `LIN_TOKEN` or `--token` to keep
the same login valid across server restarts; the default random token changes on
each start.

## Platform

The supported targets remain Linux x86_64 and macOS arm64. Bun's PTY API requires
a POSIX host; Windows is not supported by this application.

## Session lifetime and restoration

Sessions and their creation order belong to the running server. Refreshing,
closing a browser window or disconnecting does not end a session. Opening the
same server again restores its tabs, screen, colors, cursor and recent history.
Closing a terminal tab, exiting its shell or stopping lin ends the session.
The selected tab is a per-browser preference.

The server runs xterm headless directly in Bun and retains up to 10,000
scrollback lines per terminal, plus its current normal/alternate screen. Output
continues to update this model while disconnected. The browser restores a
snapshot before consuming live output and retries interrupted connections.
History and sessions are in memory, not persisted across server restarts.
Multiple browser windows share the same session list and shell processes.
Only one window controls each session's input and size. The first attachment
gets control; other windows are read-only until **Take control** is clicked.
Disconnecting releases control, but does not automatically hand it to an existing
viewer. A newly attached window can claim an unowned session.

The server answers terminal device and color queries, including while detached.
Browser views never resend parser-generated replies, and screen restoration
blocks user input until the snapshot and control assignment have arrived.
The controlling browser supplies the session's color theme.

## Terminal interaction

macOS Option-arrow word movement and Safari Shift-symbol handling follow
Goblin's terminal behavior. IME composition is left to xterm. HTTP(S) links,
including OSC 8 hyperlinks, open in a separate tab. On touch devices, the terminal
provides scrollback gestures, cursor keys, Esc, Tab, Ctrl-C, and a file picker;
normal scrollback gestures do not intercept full-screen mouse applications.
The viewport follows the software keyboard without observing font loading.

Paste or drop files to upload them and insert shell-quoted paths without pressing
Enter. Ordinary text and spreadsheet pastes retain xterm's bracketed-paste behavior.
Files are stored on the lin server, not at their original browser-side paths.
The limit is 25 MiB per file, 32 MiB and 256 files per request, and 256 MiB / 1,024
files retained per running server. Uploads are private temporary files and are
removed on normal server shutdown. Input is not replayed if control or connection
changes during upload; paste again explicitly in the controlling window.

Screen parsing, snapshots, and resize notifications are ordered per session.
Slow WebSocket viewers are disconnected and restore a fresh snapshot on reconnect.
A session is closed if its pending screen-parser output exceeds 16 MiB, keeping
pathological terminal output from growing the server's memory without bound.

## Appearance

The UI follows Goblin's default macOS palette and compact toolbar styling.
Light, dark and system themes share CSS design tokens in `web/src/theme/`;
xterm reads the same tokens rather than maintaining a separate color palette.
See [the token contract](web/src/theme/README.md).
