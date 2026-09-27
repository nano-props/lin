package nano.lin.server;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class SessionPersistenceTest {
    private static final String TOKEN = "test-session-token-only";

    @Test
    void retainsDetachedProcessAndScreenPastFormerTimeoutAndExplicitlyCloses() throws Exception {
        try (var server = new LinServer(new ServerConfig(InetAddress.getLoopbackAddress(), 0, TOKEN));
             var client = HttpClient.newHttpClient()) {
            server.start();
            var base = URI.create(server.accessUrl().split("/\\?")[0]);
            assertEquals(401, client.send(HttpRequest.newBuilder(base.resolve("/api/sessions")).GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode());
            var created = request(client, base, "POST", "/api/sessions");
            assertEquals(201, created.statusCode());
            var id = created.body().replace("\"", "");
            var other = request(client, base, "POST", "/api/sessions").body().replace("\"", "");
            assertEquals("[\"" + id + "\",\"" + other + "\"]", request(client, base, "GET", "/api/sessions").body());
            var first = new Messages();
            var socket = connect(client, base, id, first);
            first.awaitType(4);
            send(socket, "export LIN_TEST_VALUE=retained; cd /tmp; printf 'before-%s\\n' refresh\n");
            first.awaitText("before-refresh");
            send(socket, "sleep 1; printf 'offline-%s\\n' output\n");
            socket.sendClose(WebSocket.NORMAL_CLOSURE, "reload").join();
            Thread.sleep(31_000);
            assertTrue(request(client, base, "GET", "/api/sessions").body().contains(id));
            var second = new Messages();
            var reconnected = connect(client, base, id, second);
            var snapshot = second.awaitType(4);
            assertTrue(new String(snapshot, 5, snapshot.length - 5, StandardCharsets.UTF_8).contains("before-refresh"));
            assertTrue(new String(snapshot, 5, snapshot.length - 5, StandardCharsets.UTF_8).contains("offline-output"));
            send(reconnected, "printf 'state:%s:%s\\n' \"$LIN_TEST_VALUE\" \"$PWD\"\n");
            second.awaitText("state:retained:/tmp");
            assertEquals(204, request(client, base, "DELETE", "/api/sessions?session=" + id).statusCode());
            second.awaitType(2);
            assertFalse(request(client, base, "GET", "/api/sessions").body().contains(id));
            assertEquals(204, request(client, base, "DELETE", "/api/sessions?session=" + other).statusCode());
            assertEquals("[]", request(client, base, "GET", "/api/sessions").body());
        }
    }

    private static HttpResponse<String> request(HttpClient client, URI base, String method, String path) throws Exception {
        return client.send(HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(20))
            .header("Cookie", "lin_access=" + TOKEN).header("Origin", base.toString())
            .method(method, HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
    }

    private static WebSocket connect(HttpClient client, URI base, String id, Messages listener) {
        return client.newWebSocketBuilder().header("Cookie", "lin_access=" + TOKEN).header("Origin", base.toString())
            .buildAsync(URI.create(base.toString().replace("http:", "ws:") + "/ws?session=" + id), listener).join();
    }

    private static void send(WebSocket socket, String input) {
        var bytes = input.getBytes(StandardCharsets.UTF_8);
        socket.sendBinary(ByteBuffer.allocate(bytes.length + 1).put((byte)0).put(bytes).flip(), true).join();
    }

    private static final class Messages implements WebSocket.Listener {
        private final BlockingQueue<byte[]> messages = new LinkedBlockingQueue<>();
        private final ByteArrayOutputStream partial = new ByteArrayOutputStream();
        @Override public void onOpen(WebSocket socket) { socket.request(1); }
        @Override public CompletionStage<?> onBinary(WebSocket socket, ByteBuffer data, boolean last) {
            var bytes = new byte[data.remaining()]; data.get(bytes); partial.writeBytes(bytes);
            if (last) { messages.add(partial.toByteArray()); partial.reset(); }
            socket.request(1);
            return null;
        }
        byte[] awaitType(int type) throws Exception {
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
            while (System.nanoTime() < deadline) {
                var bytes = messages.poll(1, TimeUnit.SECONDS);
                if (bytes != null && bytes[0] == type) return bytes;
            }
            throw new AssertionError("Missing terminal message type " + type);
        }
        void awaitText(String expected) throws Exception {
            var received = new StringBuilder();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
            while (System.nanoTime() < deadline) {
                var bytes = messages.poll(1, TimeUnit.SECONDS);
                if (bytes != null && bytes[0] == 0) {
                    received.append(new String(bytes, 1, bytes.length - 1, StandardCharsets.UTF_8));
                    if (received.toString().contains(expected)) return;
                }
            }
            throw new AssertionError("Missing terminal text: " + expected + " in " + received);
        }
    }
}
