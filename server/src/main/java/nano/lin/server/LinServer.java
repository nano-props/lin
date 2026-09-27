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
import java.util.UUID;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.stream.Collectors;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;

public final class LinServer implements AutoCloseable {
    private static final String AUTH_COOKIE = "lin_access";
    private final ServerConfig config;
    private final ServerSocket serverSocket = new ServerSocket();
    // Insertion order is the shared tab order. Never close a session under this lock.
    private final LinkedHashMap<String, PtySession> sessions = new LinkedHashMap<>();
    private final CountDownLatch stopped = new CountDownLatch(1);
    private final AtomicBoolean closed = new AtomicBoolean();
    private final HttpRouter router;
    private volatile int boundPort;

    public LinServer(ServerConfig config) throws IOException {
        this.config = config;
        serverSocket.setReuseAddress(true);
        StaticResourceHandler resources = new StaticResourceHandler();
        router = new HttpRouter()
            .route("/api/auth", exchange -> authenticate(exchange.output(), exchange.input(), exchange.request()))
            .route("/api/auth/status", exchange -> authStatus(exchange.output(), exchange.request()))
            .route("/api/sessions", this::sessionApi)
            .route("/ws", exchange -> upgradeWebSocket(exchange.socket(), exchange.input(), exchange.output(), exchange.request(), exchange.target()))
            .fallback(resources::serve);
    }

    public void start() throws IOException {
        serverSocket.bind(new InetSocketAddress(config.address(), config.port()));
        boundPort = serverSocket.getLocalPort();
        Thread.ofPlatform().name("lin-http-accept").start(this::acceptLoop);
    }

    public String accessUrl() {
        var host = config.address().isAnyLocalAddress() ? "127.0.0.1" : config.address().getHostAddress();
        return "http://" + host + ":" + boundPort + "/?token=" + config.token();
    }

    public void await() throws InterruptedException {
        stopped.await();
    }

    private void acceptLoop() {
        try {
            while (!closed.get()) {
                var socket = serverSocket.accept();
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
            var input = new BufferedInputStream(socket.getInputStream());
            var output = socket.getOutputStream();
            var request = HttpRequest.read(input);
            var target = parseTarget(request.target());
            router.dispatch(new HttpExchange(socket, input, output, request, target));
        } catch (Exception error) {
            if (!closed.get() && !(error instanceof IOException)) {
                System.err.println("lin: request failed: " + error.getMessage());
            }
        }
    }

    private void upgradeWebSocket(
        Socket socket,
        BufferedInputStream input,
        OutputStream output,
        HttpRequest request,
        URI target
    ) throws IOException {
        if (!"GET".equals(request.method()) || !"websocket".equalsIgnoreCase(request.header("upgrade"))) {
            HttpResponse.error(output, 400, "WebSocket upgrade required");
            return;
        }
        if (!authenticated(request)) { HttpResponse.error(output, 401, "Authentication required"); return; }
        if (!validOrigin(request.header("origin"), request.header("host"))) {
            HttpResponse.error(output, 403, "Invalid WebSocket origin");
            return;
        }
        var key = request.header("sec-websocket-key");
        if (key == null || !"13".equals(request.header("sec-websocket-version"))) {
            HttpResponse.error(output, 400, "Unsupported WebSocket handshake");
            return;
        }

        socket.setSoTimeout(0);
        var sessionId = sessionId(target);
        PtySession session;
        synchronized (sessions) { session = sessions.get(sessionId); }
        if (session == null) { HttpResponse.error(output, 404, "Terminal session not found"); return; }
        var connection = WebSocketConnection.accept(socket, input, output, key);
        connection.run(session);
    }

    private void sessionApi(HttpExchange exchange) throws IOException {
        var request = exchange.request();
        var output = exchange.output();
        if (!authenticated(request)) { HttpResponse.error(output, 401, "Authentication required"); return; }
        if ("GET".equals(request.method())) {
            String json;
            synchronized (sessions) {
                json = sessions.keySet().stream().map(id -> "\"" + id + "\"").collect(Collectors.joining(",", "[", "]"));
            }
            HttpResponse.write(output, 200, "OK", "application/json", json.getBytes(StandardCharsets.UTF_8), false, null);
            return;
        }
        if (!validOrigin(request.header("origin"), request.header("host"))) {
            HttpResponse.error(output, 403, "Invalid session request"); return;
        }
        if ("POST".equals(request.method())) {
            var id = UUID.randomUUID().toString();
            var session = new PtySession(code -> { synchronized (sessions) { sessions.remove(id); } });
            synchronized (sessions) {
                if (closed.get()) { HttpResponse.error(output, 503, "Server is stopping"); return; }
                sessions.put(id, session);
            }
            try { session.start(80, 24); }
            catch (IOException | RuntimeException error) {
                synchronized (sessions) { sessions.remove(id); }
                session.close();
                HttpResponse.error(output, 500, "Unable to start terminal");
                return;
            }
            HttpResponse.write(output, 201, "Created", "application/json", ("\"" + id + "\"").getBytes(StandardCharsets.UTF_8), false, null);
        } else if ("DELETE".equals(request.method())) {
            final String id;
            try { id = sessionId(exchange.target()); }
            catch (IOException error) { HttpResponse.error(output, 400, "Invalid terminal session id"); return; }
            PtySession session;
            synchronized (sessions) { session = sessions.remove(id); }
            if (session != null) session.close();
            HttpResponse.write(output, 204, "No Content", "text/plain", new byte[0], false, null);
        } else {
            HttpResponse.error(output, 405, "Method not allowed");
        }
    }

    private static String sessionId(URI target) throws IOException {
        var query = target.getRawQuery();
        if (query == null) throw new IOException("missing terminal session id");
        for (var part : query.split("&")) {
            var pair = part.split("=", 2);
            if (pair.length == 2 && pair[0].equals("session")) {
                try {
                    return UUID.fromString(pair[1]).toString();
                } catch (IllegalArgumentException error) {
                    throw new IOException("invalid terminal session id", error);
                }
            }
        }
        throw new IOException("missing terminal session id");
    }

    private boolean validOrigin(String origin, String host) {
        if (origin == null || host == null) return false;
        return origin.equals("http://" + host) || origin.equals("https://" + host);
    }

    private void authenticate(OutputStream output, InputStream input, HttpRequest request) throws IOException {
        if (!"POST".equals(request.method()) || !validOrigin(request.header("origin"), request.header("host"))) {
            HttpResponse.error(output, 403, "Invalid authentication request"); return;
        }
        var body = request.readBody(input, 4096);
        if (!constantTimeEquals(config.token(), new String(body, StandardCharsets.UTF_8).trim())) {
            HttpResponse.error(output, 401, "Invalid access token"); return;
        }
        HttpResponse.write(output, 204, "No Content", "text/plain; charset=utf-8", new byte[0], false, authCookie(request));
    }

    private void authStatus(OutputStream output, HttpRequest request) throws IOException {
        if (!authenticated(request)) { HttpResponse.error(output, 401, "Authentication required"); return; }
        HttpResponse.write(output, 204, "No Content", "text/plain; charset=utf-8", new byte[0], false, null);
    }

    private boolean authenticated(HttpRequest request) {
        return constantTimeEquals(config.token(), cookie(request.header("cookie"), AUTH_COOKIE));
    }

    private static String cookie(String header, String name) {
        if (header == null) return null;
        for (var item : header.split(";")) {
            var pair = item.trim().split("=", 2);
            if (pair.length == 2 && pair[0].equals(name)) return pair[1];
        }
        return null;
    }

    private String authCookie(HttpRequest request) {
        var forwarded = request.header("x-forwarded-proto");
        var origin = request.header("origin");
        var secure = "https".equalsIgnoreCase(forwarded) || (origin != null && origin.startsWith("https://"));
        return AUTH_COOKIE + "=" + config.token() + (secure ? "; Secure" : "") + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800";
    }

    private static URI parseTarget(String target) throws IOException {
        try {
            return new URI(target);
        } catch (URISyntaxException error) {
            throw new IOException("invalid request target", error);
        }
    }

    private static boolean constantTimeEquals(String expected, String actual) {
        if (actual == null) return false;
        return MessageDigest.isEqual(
            expected.getBytes(StandardCharsets.UTF_8),
            actual.getBytes(StandardCharsets.UTF_8)
        );
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) return;
        List<PtySession> remaining;
        synchronized (sessions) { remaining = List.copyOf(sessions.values()); sessions.clear(); }
        remaining.forEach(PtySession::close);
        try {
            serverSocket.close();
        } catch (IOException ignored) {
            // The server is already shutting down.
        }
        stopped.countDown();
    }
}
