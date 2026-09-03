package nano.lin.server;

import nano.lin.pty.PtySession;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;

public final class LinServer implements AutoCloseable {
    private final ServerConfig config;
    private final ServerSocket serverSocket = new ServerSocket();
    private final Set<PtySession> sessions = ConcurrentHashMap.newKeySet();
    private final CountDownLatch stopped = new CountDownLatch(1);
    private final AtomicBoolean closed = new AtomicBoolean();
    private final TempFileStore tempFiles;
    private volatile int boundPort;

    public LinServer(ServerConfig config) throws IOException {
        this.config = config;
        this.tempFiles = new TempFileStore();
        serverSocket.setReuseAddress(true);
    }

    public void start() throws IOException {
        serverSocket.bind(new InetSocketAddress(config.address(), config.port()));
        boundPort = serverSocket.getLocalPort();
        Thread.ofPlatform().name("lin-http-accept").start(this::acceptLoop);
    }

    public String accessUrl() {
        String host = config.address().isAnyLocalAddress() ? "127.0.0.1" : config.address().getHostAddress();
        return "http://" + host + ":" + boundPort + "/?token=" + config.token();
    }

    public void await() throws InterruptedException {
        stopped.await();
    }

    private void acceptLoop() {
        try {
            while (!closed.get()) {
                Socket socket = serverSocket.accept();
                socket.setTcpNoDelay(true);
                socket.setSoTimeout(10_000);
                Thread.ofVirtual().name("lin-http-client").start(() -> handle(socket));
            }
        } catch (IOException error) {
            if (!closed.get()) System.err.println("lin: accept failed: " + error.getMessage());
        } finally {
            stopped.countDown();
        }
    }

    private void handle(Socket socket) {
        try (socket) {
            BufferedInputStream input = new BufferedInputStream(socket.getInputStream());
            OutputStream output = socket.getOutputStream();
            HttpRequest request = HttpRequest.read(input);
            URI target = parseTarget(request.target());
            if ("/ws".equals(target.getPath())) {
                upgradeWebSocket(socket, input, output, request, target);
            } else if ("/api/temp-files".equals(target.getPath())) {
                uploadTempFile(output, input, request);
            } else {
                serveResource(output, request, target.getPath());
            }
        } catch (Exception error) {
            if (!closed.get() && !(error instanceof IOException)) {
                System.err.println("lin: request failed: " + error.getMessage());
            }
        }
    }

    private void uploadTempFile(OutputStream output, InputStream input, HttpRequest request) throws IOException {
        if (!"POST".equals(request.method())) { writeError(output, 405, "Method not allowed"); return; }
        if (!constantTimeEquals(config.token(), request.header("x-lin-access-token"))) { writeError(output, 401, "Invalid access token"); return; }
        if (!validOrigin(request.header("origin"), request.header("host"))) { writeError(output, 403, "Invalid origin"); return; }
        byte[] body;
        try { body = request.readBody(input, TempFileStore.MAX_FILE_BYTES); }
        catch (IOException error) { writeError(output, 413, error.getMessage()); return; }
        if (body.length == 0) { writeError(output, 400, "Empty file"); return; }
        var path = tempFiles.store(request.header("x-lin-filename"), body);
        String json = "{\"path\":\"" + jsonEscape(path.toString()) + "\",\"expiresInSeconds\":3600}";
        writeResponse(output, 201, "Created", "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8), false);
    }

    private static String jsonEscape(String value) { return value.replace("\\", "\\\\").replace("\"", "\\\""); }

    private void upgradeWebSocket(
        Socket socket,
        BufferedInputStream input,
        OutputStream output,
        HttpRequest request,
        URI target
    ) throws IOException {
        if (!"GET".equals(request.method()) || !"websocket".equalsIgnoreCase(request.header("upgrade"))) {
            writeError(output, 400, "WebSocket upgrade required");
            return;
        }
        String token = queryParameter(target.getRawQuery(), "token");
        if (!constantTimeEquals(config.token(), token)) {
            writeError(output, 401, "Invalid access token");
            return;
        }
        if (!validOrigin(request.header("origin"), request.header("host"))) {
            writeError(output, 403, "Invalid WebSocket origin");
            return;
        }
        String key = request.header("sec-websocket-key");
        if (key == null || !"13".equals(request.header("sec-websocket-version"))) {
            writeError(output, 400, "Unsupported WebSocket handshake");
            return;
        }

        socket.setSoTimeout(0);
        WebSocketConnection connection = WebSocketConnection.accept(input, output, key);
        PtySession session = new PtySession(connection::sendOutput, connection::sendExit);
        sessions.add(session);
        try {
            connection.run(session);
        } finally {
            sessions.remove(session);
            session.close();
        }
    }

    private boolean validOrigin(String origin, String host) {
        if (origin == null || host == null) return false;
        return origin.equals("http://" + host) || origin.equals("https://" + host);
    }

    private void serveResource(OutputStream output, HttpRequest request, String path) throws IOException {
        if (!"GET".equals(request.method()) && !"HEAD".equals(request.method())) {
            writeError(output, 405, "Method not allowed");
            return;
        }
        String resourcePath = switch (path) {
            case "", "/" -> "web/index.html";
            default -> path.startsWith("/") ? "web" + path : "web/" + path;
        };
        if (resourcePath.contains("..")) {
            writeError(output, 404, "Not found");
            return;
        }

        byte[] body;
        try (InputStream resource = LinServer.class.getClassLoader().getResourceAsStream(resourcePath)) {
            if (resource == null) {
                writeError(output, 404, "Not found");
                return;
            }
            body = resource.readAllBytes();
        }
        writeResponse(output, 200, "OK", contentType(resourcePath), body, "HEAD".equals(request.method()));
    }

    private static URI parseTarget(String target) throws IOException {
        try {
            return new URI(target);
        } catch (URISyntaxException error) {
            throw new IOException("invalid request target", error);
        }
    }

    private static String queryParameter(String query, String name) {
        if (query == null) return null;
        for (String part : query.split("&")) {
            int separator = part.indexOf('=');
            String key = separator < 0 ? part : part.substring(0, separator);
            if (key.equals(name)) return separator < 0 ? "" : part.substring(separator + 1);
        }
        return null;
    }

    private static boolean constantTimeEquals(String expected, String actual) {
        if (actual == null) return false;
        return MessageDigest.isEqual(
            expected.getBytes(StandardCharsets.UTF_8),
            actual.getBytes(StandardCharsets.UTF_8)
        );
    }

    private static String contentType(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html; charset=utf-8";
        if (lower.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private static void writeError(OutputStream output, int status, String message) throws IOException {
        writeResponse(
            output,
            status,
            message,
            "text/plain; charset=utf-8",
            (message + "\n").getBytes(StandardCharsets.UTF_8),
            false
        );
    }

    private static void writeResponse(
        OutputStream output,
        int status,
        String reason,
        String contentType,
        byte[] body,
        boolean headOnly
    ) throws IOException {
        String headers = "HTTP/1.1 " + status + " " + reason + "\r\n"
            + "Content-Type: " + contentType + "\r\n"
            + "Content-Length: " + body.length + "\r\n"
            + "Cache-Control: no-store\r\n"
            + "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            + "font-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:\r\n"
            + "Referrer-Policy: no-referrer\r\n"
            + "X-Content-Type-Options: nosniff\r\n"
            + "X-Frame-Options: DENY\r\n"
            + "Cross-Origin-Resource-Policy: same-origin\r\n"
            + "Connection: close\r\n\r\n";
        output.write(headers.getBytes(StandardCharsets.US_ASCII));
        if (!headOnly) output.write(body);
        output.flush();
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) return;
        sessions.forEach(PtySession::close);
        try {
            serverSocket.close();
        } catch (IOException ignored) {
            // The server is already shutting down.
        }
        tempFiles.close();
        stopped.countDown();
    }
}
